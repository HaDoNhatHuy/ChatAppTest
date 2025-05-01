const connection = new signalR.HubConnectionBuilder()
    .withUrl("/chatHub?username=" + encodeURIComponent(currentUser))
    .configureLogging(signalR.LogLevel.Information)
    .build();

let currentFriend = null;
let peer = null;
let localStream = null;
let incomingCaller = null;
let remoteUser = null;
let typingTimeout = null;
let oldestMessageId = null;
let isLoadingMessages = false;
let friendsList = [];
let mediaRecorder = null;
let audioChunks = [];

// Hàm formatRecordingTime được định nghĩa ở phạm vi toàn cục
function formatRecordingTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) {
        return "Error";
    }
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}

// Thêm IntersectionObserver để phát hiện tin nhắn hiển thị trong viewport
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const messageElement = entry.target;
            const messageId = parseInt(messageElement.dataset.messageId);
            const isReceiver = messageElement.classList.contains("received");

            if (isReceiver && messageElement.dataset.seen === "false") {
                connection.invoke("MarkMessageAsSeen", messageId, currentUser).catch(err => {
                    console.error("Error marking message as seen:", err);
                });
            }
        }
    });
}, { threshold: 0.5 });

document.addEventListener("DOMContentLoaded", async () => {
    console.log("DOM loaded, initializing chat...");

    localStorage.removeItem("currentFriend");
    console.log("Cleared currentFriend from localStorage on page load");

    await startConnection();

    const messagesList = document.getElementById("messagesList");
    messagesList.addEventListener("scroll", async () => {
        if (messagesList.scrollTop === 0 && !isLoadingMessages && oldestMessageId) {
            isLoadingMessages = true;
            const loadingSpinner = document.getElementById("loadingSpinner");
            if (loadingSpinner) {
                loadingSpinner.classList.add("active");
            }

            try {
                await connection.invoke("LoadOlderMessages", currentUser, currentFriend, oldestMessageId);
            } catch (err) {
                console.error("Error loading older messages:", err);
            } finally {
                isLoadingMessages = false;
                if (loadingSpinner) {
                    loadingSpinner.classList.remove("active");
                }
            }
        }

        const scrollToBottomBtn = document.getElementById("scrollToBottomBtn");
        if (scrollToBottomBtn) {
            if (messagesList.scrollTop + messagesList.clientHeight < messagesList.scrollHeight - 50) {
                console.log("Showing scroll to bottom button on scroll");
                scrollToBottomBtn.classList.add("active");
            } else {
                console.log("Hiding scroll to bottom button on scroll");
                scrollToBottomBtn.classList.remove("active");
            }
        } else {
            console.error("Scroll to bottom button element not found!");
        }
    });

    document.getElementById("scrollToBottomBtn").addEventListener("click", () => {
        const messagesList = document.getElementById("messagesList");
        const lastMessage = messagesList.lastElementChild;
        if (lastMessage) {
            lastMessage.scrollIntoView({ behavior: "smooth", block: "end" });
            console.log("Scrolled to bottom via button");
        }
        const scrollToBottomBtn = document.getElementById("scrollToBottomBtn");
        if (scrollToBottomBtn) {
            scrollToBottomBtn.classList.remove("active");
        }
    });

    // Tích hợp Emoji Picker
    const emojiButton = document.getElementById("emojiButton");
    const emojiPicker = document.getElementById("emojiPicker");
    const messageInput = document.getElementById("messageInput");

    emojiButton.addEventListener("click", () => {
        const isVisible = emojiPicker.style.display === "block";
        emojiPicker.style.display = isVisible ? "none" : "block";
    });

    emojiPicker.addEventListener("emoji-click", (event) => {
        messageInput.value += event.detail.unicode;
        emojiPicker.style.display = "none"; // Ẩn picker sau khi chọn
    });

    // Đóng picker khi click ra ngoài
    document.addEventListener("click", (event) => {
        if (
            !emojiPicker.contains(event.target) &&
            !emojiButton.contains(event.target)
        ) {
            emojiPicker.style.display = "none";
        }
    });

    // Tích hợp Voice Message
    const voiceButton = document.getElementById("voiceButton");
    const recordingTimerDisplay = document.getElementById("recordingTimerDisplay");
    let isRecording = false;
    let recordingSeconds = 0;
    let recordingTimer = null;

    voiceButton.addEventListener("click", async () => {
        if (!isRecording) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
                audioChunks = [];

                mediaRecorder.ondataavailable = (event) => {
                    audioChunks.push(event.data);
                };

                mediaRecorder.onstop = async () => {
                    clearInterval(recordingTimer);
                    recordingSeconds = 0;
                    recordingTimerDisplay.style.display = "none";
                    voiceButton.parentElement.classList.remove('recording-active');

                    if (audioChunks.length > 0) {
                        // Chuyển đổi audio/webm sang audio/mp3 bằng lamejs
                        const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
                        const arrayBuffer = await audioBlob.arrayBuffer();
                        const audioContext = new AudioContext();
                        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

                        const wav = audioBuffer.getChannelData(0); // Lấy dữ liệu âm thanh (mono channel)
                        const mp3Encoder = new lamejs.Mp3Encoder(1, audioBuffer.sampleRate, 128); // Mono, 128kbps
                        const mp3Data = [];
                        const samples = new Int16Array(wav.length);
                        for (let i = 0; i < wav.length; i++) {
                            samples[i] = wav[i] * 32767; // Chuyển đổi sang 16-bit PCM
                        }
                        const mp3Buffer = mp3Encoder.encodeBuffer(samples);
                        const endBuffer = mp3Encoder.flush();
                        mp3Data.push(mp3Buffer);
                        mp3Data.push(endBuffer);

                        const mp3Blob = new Blob(mp3Data, { type: 'audio/mp3' });
                        const fileSize = mp3Blob.size; // Lấy kích thước file tại client
                        const formData = new FormData();
                        formData.append("file", mp3Blob, "voice-message.mp3");

                        voiceButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

                        const response = await fetch("/api/upload", {
                            method: "POST",
                            body: formData
                        });

                        const data = await response.json();
                        if (data.fileUrl && currentFriend) {
                            connection.invoke("SendFileMessage", currentUser, currentFriend, data.fileUrl, "Voice", fileSize);
                        }

                        voiceButton.innerHTML = '<i class="fas fa-microphone"></i>';
                    }

                    stream.getTracks().forEach(track => track.stop());
                };

                mediaRecorder.start();
                recordingSeconds = 0;
                recordingTimerDisplay.style.display = "inline";
                recordingTimerDisplay.innerHTML = `<i class="fas fa-circle"></i> ${formatRecordingTime(recordingSeconds)}`;
                voiceButton.parentElement.classList.add('recording-active');

                recordingTimer = setInterval(() => {
                    recordingSeconds++;
                    recordingTimerDisplay.innerHTML = `<i class="fas fa-circle"></i> ${formatRecordingTime(recordingSeconds)}`;
                    if (recordingSeconds >= 115) {
                        recordingTimerDisplay.style.color = '#ff3b30';
                    }
                }, 1000);

                setTimeout(() => {
                    if (isRecording) {
                        mediaRecorder.stop();
                        isRecording = false;
                        voiceButton.innerHTML = '<i class="fas fa-microphone"></i>';
                        voiceButton.title = "Record Voice Message";
                        voiceButton.parentElement.classList.remove('recording-active');
                    }
                }, 120000);

                isRecording = true;
                voiceButton.innerHTML = '<i class="fas fa-stop"></i>';
                voiceButton.title = "Stop Recording";
            } catch (err) {
                console.error("Error accessing microphone:", err);
                toastr.error("Unable to access microphone. Please check your permissions.");
            }
        } else {
            clearInterval(recordingTimer);
            recordingSeconds = 0;
            recordingTimerDisplay.style.display = "none";
            voiceButton.parentElement.classList.remove('recording-active');

            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            }

            isRecording = false;
            voiceButton.innerHTML = '<i class="fas fa-microphone"></i>';
            voiceButton.title = "Record Voice Message";
        }
    });
});

async function startConnection() {
    try {
        if (connection.state === signalR.HubConnectionState.Connected) {
            console.log("SignalR connection already established.");
            return;
        }

        if (connection.state !== signalR.HubConnectionState.Disconnected) {
            console.log(`SignalR connection is in ${connection.state} state. Stopping current connection...`);
            await connection.stop();
        }

        console.log("Attempting to start SignalR connection...");
        await connection.start();
        console.log("SignalR Connected.");

        await Promise.all([
            connection.invoke("GetFriends", currentUser),
            connection.invoke("GetFriendRequests", currentUser),
            connection.invoke("GetUnreadCounts", currentUser)
        ]);
    } catch (err) {
        console.error("Error starting SignalR connection:", err);
        alert("Failed to connect to the server. Retrying in 5 seconds...");
        setTimeout(startConnection, 5000);
    }
}

connection.onclose(async (error) => {
    console.log("SignalR connection closed. Error:", error);
    alert("Lost connection to the server. Attempting to reconnect...");
    await startConnection();
});

connection.on("ReceiveMessage", (sender, message, receiver, messageType = "Text", fileUrl = null, isPinned = false, messageId, timestamp, fileSize = 0) => {
    console.log(`Received message: Sender=${sender}, Receiver=${receiver}, Content=${message}, Type=${messageType}, ID=${messageId}, Timestamp=${timestamp}, FileSize=${fileSize}`);
    if ((sender === currentFriend && receiver === currentUser) || (sender === currentUser && receiver === currentFriend)) {
        const messagesList = document.getElementById("messagesList");
        if (!messagesList) {
            console.error("Messages list element not found!");
            return;
        }

        const lastMessage = messagesList.lastElementChild;
        const messageDate = new Date(timestamp);
        const messageDateString = messageDate.toLocaleDateString('vi-VN');

        let lastMessageDateString = null;
        if (lastMessage && lastMessage.dataset.timestamp) {
            const lastMessageDate = new Date(lastMessage.dataset.timestamp);
            lastMessageDateString = lastMessageDate.toLocaleDateString('vi-VN');
        }

        if (!lastMessageDateString || messageDateString !== lastMessageDateString) {
            const divider = document.createElement("div");
            divider.className = `date-divider date-${messageDateString}`;
            divider.innerHTML = `<span>${messageDateString}</span>`;
            messagesList.appendChild(divider);
        }

        const li = document.createElement("li");
        li.className = `message ${sender === currentUser ? "sent" : "received"} ${isPinned ? "pinned" : ""}`;
        li.dataset.messageId = messageId;
        li.dataset.timestamp = timestamp;
        li.dataset.seen = "false";
        let content = message;

        const formatFileSize = (bytes) => {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };

        if (messageType === "Image") {
            content = `
                <div class="image-message-container">
                    <img src="${fileUrl}" alt="Image" />
                </div>
            `;
        } else if (messageType === "File") {
            const fileName = fileUrl.split('/').pop();
            const fileExtension = fileName.split('.').pop().toLowerCase();
            let fileTypeClass = 'other';
            if (['doc', 'docx'].includes(fileExtension)) fileTypeClass = 'document';
            else if (['xls', 'xlsx'].includes(fileExtension)) fileTypeClass = 'spreadsheet';
            else if (['ppt', 'pptx'].includes(fileExtension)) fileTypeClass = 'presentation';
            else if (fileExtension === 'pdf') fileTypeClass = 'pdf';
            else if (['zip', 'rar'].includes(fileExtension)) fileTypeClass = 'archive';
            else if (['js', 'html', 'css', 'py'].includes(fileExtension)) fileTypeClass = 'code';

            content = `
                <div class="file-message-container">
                    <div class="file-icon ${fileTypeClass}">
                        <i class="fas fa-file"></i>
                        <span class="file-extension">${fileExtension}</span>
                    </div>
                    <div class="file-details">
                        <div class="file-name">${fileName}</div>
                        <div class="file-meta">
                            <span class="file-size">${formatFileSize(fileSize)}</span>
                            <a href="${fileUrl}" class="file-link" target="_blank">Download</a>
                        </div>
                    </div>
                </div>
            `;
        } else if (messageType === "Voice") {
            content = `
                <div class="voice-message-container">
                    <div class="voice-controls">
                        <i class="fas fa-play voice-message-icon" style="padding:10.5px;"></i>
                        <span class="voice-message-duration">0:00</span>
                    </div>
                    <div class="voice-message-content">
                        <div class="voice-message-waveform">
                            <div class="voice-waveform-bars">
                                <div class="waveform-bar"></div>
                                <div class="waveform-bar"></div>
                                <div class="waveform-bar"></div>
                                <div class="waveform-bar"></div>
                                <div class="waveform-bar"></div>
                                <div class="waveform-bar"></div>
                                <div class="waveform-bar"></div>
                                <div class="waveform-bar"></div>
                                <div class="waveform-bar"></div>
                            </div>
                        </div>
                        <div class="voice-progress">
                            <div class="voice-progress-bar"></div>
                        </div>
                    </div>
                    <audio class="voice-audio" style="display: none;">
                        <source src="${fileUrl}" type="audio/mp3">
                        Your browser does not support the audio element.
                    </audio>
                </div>
            `;
        }

        li.innerHTML = `
            <img src="/images/avatars/${sender}.jpg" class="avatar" onerror="this.src='/images/avatars/default.jpg'" />
            <div class="content">
                <span>${content}</span>
                <small>${messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                ${sender === currentUser ? `<small class="seen-indicator text-success" style="display: none;" title="Seen"><i class="fas fa-check-double"></i></small>` : ""}
                <button class="pin-button btn btn-sm btn-outline-secondary">${isPinned ? "Unpin" : "Pin"}</button>
            </div>
        `;
        messagesList.appendChild(li);
        observer.observe(li);

        if (messageType === "Voice") {
            const container = li.querySelector('.voice-message-container');
            const audio = container.querySelector('.voice-audio');
            const playButton = container.querySelector('.voice-message-icon');
            const durationSpan = container.querySelector('.voice-message-duration');
            const waveformBars = container.querySelector('.voice-waveform-bars');
            const progressBar = container.querySelector('.voice-progress-bar');

            // Thêm kiểm tra lỗi khi tải file âm thanh
            audio.onerror = () => {
                console.error(`Failed to load audio from ${fileUrl}`);
                durationSpan.textContent = "Error";
                durationSpan.style.color = "red";
            };

            // Tải file âm thanh và lấy thời lượng
            audio.onloadedmetadata = () => {
                const duration = audio.duration;
                console.log(`Audio duration for ${fileUrl}: ${duration} seconds`);
                if (!isFinite(duration) || duration <= 0) {
                    durationSpan.textContent = "Error";
                    durationSpan.style.color = "red";
                } else {
                    durationSpan.textContent = formatRecordingTime(Math.round(duration));
                }
            };

            // Buộc tải lại file âm thanh để đảm bảo sự kiện onloadedmetadata được gọi
            audio.load();

            playButton.addEventListener('click', () => {
                if (audio.paused) {
                    audio.play().catch(err => {
                        console.error(`Error playing audio from ${fileUrl}:`, err);
                        toastr.error("Failed to play audio. Please check the file.");
                    });
                    playButton.classList.remove('fa-play');
                    playButton.classList.add('fa-pause');
                    container.classList.add('playing');
                    waveformBars.classList.add('active');
                } else {
                    audio.pause();
                    playButton.classList.remove('fa-pause');
                    playButton.classList.add('fa-play');
                    container.classList.remove('playing');
                    waveformBars.classList.remove('active');
                }
            });

            audio.ontimeupdate = () => {
                if (isFinite(audio.duration) && audio.duration > 0) {
                    const progress = (audio.currentTime / audio.duration) * 100;
                    progressBar.style.width = `${progress}%`;
                }
            };

            audio.onended = () => {
                playButton.classList.remove('fa-pause');
                playButton.classList.add('fa-play');
                container.classList.remove('playing');
                waveformBars.classList.remove('active');
                progressBar.style.width = '0%';
            };
        }

        if (!oldestMessageId || messageId < oldestMessageId) {
            oldestMessageId = messageId;
        }

        if (messageType === "Image") {
            const img = li.querySelector('.image-message-container img');
            img.addEventListener('click', () => {
                const lightbox = document.createElement('div');
                lightbox.className = 'image-lightbox';
                lightbox.innerHTML = `
                    <div class="lightbox-content">
                        <img src="${fileUrl}" alt="Image" class="lightbox-image" />
                        <span class="lightbox-close">×</span>
                    </div>
                `;
                document.body.appendChild(lightbox);

                setTimeout(() => {
                    lightbox.classList.add('active');
                }, 10);

                const closeLightbox = () => {
                    lightbox.classList.remove('active');
                    setTimeout(() => {
                        lightbox.remove();
                    }, 300);
                };

                lightbox.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
                lightbox.addEventListener('click', (e) => {
                    if (e.target === lightbox) {
                        closeLightbox();
                    }
                });
            });
        }

        const scrollToBottom = (retryCount = 0) => {
            setTimeout(() => {
                const lastMessage = messagesList.lastElementChild;
                if (lastMessage) {
                    lastMessage.scrollIntoView({ behavior: "smooth", block: "end" });
                    console.log(`Auto-scrolled to bottom. ScrollHeight: ${messagesList.scrollHeight}, ScrollTop: ${messagesList.scrollTop}, ClientHeight: ${messagesList.clientHeight}`);
                }
                setTimeout(() => {
                    if (messagesList.scrollTop + messagesList.clientHeight < messagesList.scrollHeight - 50 && retryCount < 3) {
                        console.log(`Scroll to bottom failed, retrying (${retryCount + 1})...`);
                        scrollToBottom(retryCount + 1);
                    }
                }, 100);

                const scrollToBottomBtn = document.getElementById("scrollToBottomBtn");
                if (scrollToBottomBtn) {
                    if (messagesList.scrollTop + messagesList.clientHeight < messagesList.scrollHeight - 50) {
                        console.log("Showing scroll to bottom button");
                        scrollToBottomBtn.classList.add("active");
                    } else {
                        console.log("Hiding scroll to bottom button");
                        scrollToBottomBtn.classList.remove("active");
                    }
                } else {
                    console.error("Scroll to bottom button element not found!");
                }
            }, 300);
        };

        scrollToBottom();

        li.addEventListener("click", () => {
            const lastMessage = messagesList.lastElementChild;
            if (lastMessage) {
                lastMessage.scrollIntoView({ behavior: "smooth", block: "end" });
                console.log("Scrolled to bottom on message click");
            }
            const scrollToBottomBtn = document.getElementById("scrollToBottomBtn");
            if (scrollToBottomBtn) {
                scrollToBottomBtn.classList.remove("active");
            }
        });

        li.querySelector(".pin-button").addEventListener("click", () => {
            if (isPinned) {
                connection.invoke("UnpinMessage", currentUser, messageId).catch(err => console.error("Error unpinning message:", err));
            } else {
                connection.invoke("PinMessage", currentUser, messageId).catch(err => console.error("Error pinning message:", err));
            }
        });

        if (sender === currentFriend && receiver === currentUser) {
            connection.invoke("MarkMessagesAsRead", currentUser, currentFriend);
        }
    } else {
        const pendingMessages = JSON.parse(localStorage.getItem("pendingMessages") || "{}");
        if (!pendingMessages[sender]) {
            pendingMessages[sender] = [];
        }
        pendingMessages[sender].push({ sender, message, receiver, messageType, fileUrl, isPinned, messageId, timestamp, fileSize });
        localStorage.setItem("pendingMessages", JSON.stringify(pendingMessages));
    }
    connection.invoke("GetUnreadCounts", currentUser);
});

connection.on("ReceiveOlderMessages", (messages) => {
    console.log(`Received older messages: ${messages.length} messages`);
    const messagesList = document.getElementById("messagesList");
    if (!messagesList) {
        console.error("Messages list element not found!");
        return;
    }

    const currentScrollHeight = messagesList.scrollHeight;
    messages.sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));

    messages.forEach(msg => {
        const messageDate = new Date(msg.Timestamp);
        const messageDateString = messageDate.toLocaleDateString('vi-VN');

        const firstMessage = messagesList.firstElementChild;
        let firstMessageDateString = null;
        if (firstMessage && firstMessage.dataset.timestamp) {
            const firstMessageDate = new Date(firstMessage.dataset.timestamp);
            firstMessageDateString = firstMessageDate.toLocaleDateString('vi-VN');
        }

        if (!firstMessageDateString || messageDateString !== firstMessageDateString) {
            const divider = document.createElement("div");
            divider.className = `date-divider date-${messageDateString}`;
            divider.innerHTML = `<span>${messageDateString}</span>`;
            messagesList.insertBefore(divider, messagesList.firstChild);
        }

        const li = document.createElement("li");
        li.className = `message ${msg.Sender === currentUser ? "sent" : "received"} ${msg.IsPinned ? "pinned" : ""}`;
        li.dataset.messageId = msg.Id;
        li.dataset.timestamp = msg.Timestamp;
        li.dataset.seen = msg.IsSeen.toString();
        let content = msg.Content;

        const formatFileSize = (bytes) => {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };

        if (msg.MessageType === "Image") {
            content = `
                <div class="image-message-container">
                    <img src="${msg.FileUrl}" alt="Image" />
                </div>
            `;
        } else if (msg.MessageType === "File") {
            const fileName = msg.FileUrl.split('/').pop();
            const fileExtension = fileName.split('.').pop().toLowerCase();
            let fileTypeClass = 'other';
            if (['doc', 'docx'].includes(fileExtension)) fileTypeClass = 'document';
            else if (['xls', 'xlsx'].includes(fileExtension)) fileTypeClass = 'spreadsheet';
            else if (['ppt', 'pptx'].includes(fileExtension)) fileTypeClass = 'presentation';
            else if (fileExtension === 'pdf') fileTypeClass = 'pdf';
            else if (['zip', 'rar'].includes(fileExtension)) fileTypeClass = 'archive';
            else if (['js', 'html', 'css', 'py'].includes(fileExtension)) fileTypeClass = 'code';

            content = `
                <div class="file-message-container">
                    <div class="file-icon ${fileTypeClass}">
                        <i class="fas fa-file"></i>
                        <span class="file-extension">${fileExtension}</span>
                    </div>
                    <div class="file-details">
                        <div class="file-name">${fileName}</div>
                        <div class="file-meta">
                            <span class="file-size">${formatFileSize(msg.FileSize || 0)}</span>
                            <a href="${msg.FileUrl}" class="file-link" target="_blank">Download</a>
                        </div>
                    </div>
                </div>
            `;
        } else if (msg.MessageType === "Voice") {
            content = `
                <div class="voice-message-container">
                    <div class="voice-controls">
                        <i class="fas fa-play voice-message-icon" style="padding:10.5px;"></i>
                        <span class="voice-message-duration">0:00</span>
                    </div>
                    <div class="voice-message-content">
                        <div class="voice-message-waveform">
                            <div class="voice-waveform-bars">
                                <div class="waveform-bar"></div>
                                <div class="waveform-bar"></div>
                                <div class="waveform-bar"></div>
                                <div class="waveform-bar"></div>
                                <div class="waveform-bar"></div>
                                <div class="waveform-bar"></div>
                                <div class="waveform-bar"></div>
                                <div class="waveform-bar"></div>
                                <div class="waveform-bar"></div>
                            </div>
                        </div>
                        <div class="voice-progress">
                            <div class="voice-progress-bar"></div>
                        </div>
                    </div>
                    <audio class="voice-audio" style="display: none;">
                        <source src="${msg.FileUrl}" type="audio/mp3">
                        Your browser does not support the audio element.
                    </audio>
                </div>
            `;
        }

        li.innerHTML = `
            <img src="/images/avatars/${msg.Sender}.jpg" class="avatar" onerror="this.src='/images/avatars/default.jpg'" />
            <div class="content">
                <span>${content}</span>
                <small>${messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                ${msg.Sender === currentUser ? `<small class="seen-indicator text-success" style="display: ${msg.IsSeen ? 'inline' : 'none'};" title="Seen"><i class="fas fa-check-double"></i></small>` : ""}
                <button class="pin-button btn btn-sm btn-outline-secondary">${msg.IsPinned ? "Unpin" : "Pin"}</button>
            </div>
        `;
        messagesList.insertBefore(li, messagesList.firstChild);
        observer.observe(li);

        if (msg.MessageType === "Voice") {
            const container = li.querySelector('.voice-message-container');
            const audio = container.querySelector('.voice-audio');
            const playButton = container.querySelector('.voice-message-icon');
            const durationSpan = container.querySelector('.voice-message-duration');
            const waveformBars = container.querySelector('.voice-waveform-bars');
            const progressBar = container.querySelector('.voice-progress-bar');

            // Thêm kiểm tra lỗi khi tải file âm thanh
            audio.onerror = () => {
                console.error(`Failed to load audio from ${msg.FileUrl}`);
                durationSpan.textContent = "Error";
                durationSpan.style.color = "red";
            };

            // Tải file âm thanh và lấy thời lượng
            audio.onloadedmetadata = () => {
                const duration = audio.duration;
                console.log(`Audio duration for ${msg.FileUrl}: ${duration} seconds`);
                if (!isFinite(duration) || duration <= 0) {
                    durationSpan.textContent = "Error";
                    durationSpan.style.color = "red";
                } else {
                    durationSpan.textContent = formatRecordingTime(Math.round(duration));
                }
            };

            // Buộc tải lại file âm thanh để đảm bảo sự kiện onloadedmetadata được gọi
            audio.load();

            playButton.addEventListener('click', () => {
                if (audio.paused) {
                    audio.play().catch(err => {
                        console.error(`Error playing audio from ${msg.FileUrl}:`, err);
                        toastr.error("Failed to play audio. Please check the file.");
                    });
                    playButton.classList.remove('fa-play');
                    playButton.classList.add('fa-pause');
                    container.classList.add('playing');
                    waveformBars.classList.add('active');
                } else {
                    audio.pause();
                    playButton.classList.remove('fa-pause');
                    playButton.classList.add('fa-play');
                    container.classList.remove('playing');
                    waveformBars.classList.remove('active');
                }
            });

            audio.ontimeupdate = () => {
                if (isFinite(audio.duration) && audio.duration > 0) {
                    const progress = (audio.currentTime / audio.duration) * 100;
                    progressBar.style.width = `${progress}%`;
                }
            };

            audio.onended = () => {
                playButton.classList.remove('fa-pause');
                playButton.classList.add('fa-play');
                container.classList.remove('playing');
                waveformBars.classList.remove('active');
                progressBar.style.width = '0%';
            };
        }

        if (!oldestMessageId || msg.Id < oldestMessageId) {
            oldestMessageId = msg.Id;
        }

        if (msg.MessageType === "Image") {
            const img = li.querySelector('.image-message-container img');
            img.addEventListener('click', () => {
                const lightbox = document.createElement('div');
                lightbox.className = 'image-lightbox';
                lightbox.innerHTML = `
                    <div class="lightbox-content">
                        <img src="${msg.FileUrl}" alt="Image" class="lightbox-image" />
                        <span class="lightbox-close">×</span>
                    </div>
                `;
                document.body.appendChild(lightbox);

                setTimeout(() => {
                    lightbox.classList.add('active');
                }, 10);

                const closeLightbox = () => {
                    lightbox.classList.remove('active');
                    setTimeout(() => {
                        lightbox.remove();
                    }, 300);
                };

                lightbox.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
                lightbox.addEventListener('click', (e) => {
                    if (e.target === lightbox) {
                        closeLightbox();
                    }
                });
            });
        }

        li.addEventListener("click", () => {
            const lastMessage = messagesList.lastElementChild;
            if (lastMessage) {
                lastMessage.scrollIntoView({ behavior: "smooth", block: "end" });
                console.log("Scrolled to bottom on older message click");
            }
            const scrollToBottomBtn = document.getElementById("scrollToBottomBtn");
            if (scrollToBottomBtn) {
                scrollToBottomBtn.classList.remove("active");
            }
        });

        li.querySelector(".pin-button").addEventListener("click", () => {
            if (msg.IsPinned) {
                connection.invoke("UnpinMessage", currentUser, msg.Id).catch(err => console.error("Error unpinning message:", err));
            } else {
                connection.invoke("PinMessage", currentUser, msg.Id).catch(err => console.error("Error pinning message:", err));
            }
        });
    });

    messagesList.scrollTop = messagesList.scrollHeight - currentScrollHeight;
});

// Thêm sự kiện MessageSeen để cập nhật giao diện
connection.on("MessageSeen", (messageId) => {
    console.log(`Received MessageSeen for message ${messageId}`);
    const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
    if (messageElement) {
        console.log(`Updating seen status for message ${messageId}`);
        messageElement.dataset.seen = "true";
        const seenIndicator = messageElement.querySelector(".seen-indicator");
        if (seenIndicator) {
            seenIndicator.style.display = "inline";
            console.log(`Displayed seen indicator for message ${messageId}`);
        } else {
            console.error(`Seen indicator not found for message ${messageId}`);
        }
    } else {
        console.error(`Message element with ID ${messageId} not found`);
    }
});

connection.on("ReceiveNewMessageNotification", (sender) => {
    console.log(`New message notification from ${sender}`);
    if (sender !== currentFriend) {
        if ("Notification" in window) {
            const requestNotificationPermission = async () => {
                const permission = await Notification.requestPermission();
                return permission;
            };

            const sendNotification = () => {
                const notification = new Notification(`New message from ${sender}`, {
                    body: "You have a new message!",
                    icon: "/images/avatars/default.jpg"
                });
                notification.onclick = () => {
                    currentFriend = sender;
                    localStorage.setItem("currentFriend", currentFriend);
                    document.getElementById("chat-intro").textContent = `Chat with ${sender}`;
                    document.getElementById("messagesList").innerHTML = "";
                    const loadingSpinner = document.getElementById("loadingSpinner");
                    if (loadingSpinner) {
                        loadingSpinner.classList.add("active");
                    }
                    connection.invoke("LoadMessages", currentUser, sender).catch(err => {
                        console.error("Error loading messages:", err);
                    }).finally(() => {
                        if (loadingSpinner) {
                            loadingSpinner.classList.remove("active");
                        }
                        const messagesList = document.getElementById("messagesList");
                        const scrollToBottom = (retryCount = 0) => {
                            setTimeout(() => {
                                const lastMessage = messagesList.lastElementChild;
                                if (lastMessage) {
                                    lastMessage.scrollIntoView({ behavior: "smooth", block: "end" });
                                    console.log(`Scroll height after loading messages (notification): ${messagesList.scrollHeight}, ScrollTop: ${messagesList.scrollTop}, ClientHeight: ${messagesList.clientHeight}`);
                                }
                                setTimeout(() => {
                                    if (messagesList.scrollTop + messagesList.clientHeight < messagesList.scrollHeight - 50 && retryCount < 3) {
                                        console.log(`Scroll to bottom failed after loading messages (notification), retrying (${retryCount + 1})...`);
                                        scrollToBottom(retryCount + 1);
                                    }
                                }, 100);
                            }, 300);
                        };
                        scrollToBottom();
                        const messageElements = messagesList.querySelectorAll(".message");
                        messageElements.forEach(msg => observer.observe(msg));
                    });
                };
            };

            if (Notification.permission === "granted") {
                sendNotification();
            } else if (Notification.permission !== "denied") {
                requestNotificationPermission().then(permission => {
                    if (permission === "granted") {
                        sendNotification();
                    } else {
                        console.log("Notification permission denied by user.");
                    }
                });
            } else {
                console.log("Notification permission already denied.");
            }
        } else {
            console.log("This browser does not support notifications.");
        }
    }
});

connection.on("MessagePinned", (messageId, isPinned) => {
    const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
    if (messageElement) {
        messageElement.classList.toggle("pinned", isPinned);
        const pinButton = messageElement.querySelector(".pin-button");
        pinButton.textContent = isPinned ? "Unpin" : "Pin";
    }
});

connection.on("ReceiveTyping", (sender) => {
    console.log(`Received typing from ${sender}`);
    if (sender === currentFriend) {
        const typingIndicator = document.getElementById("typingIndicator");
        if (typingIndicator) {
            typingIndicator.classList.add("active");
            console.log("Typing indicator shown");
        } else {
            console.error("Typing indicator element not found!");
        }
    }
});

connection.on("ReceiveStopTyping", (sender) => {
    console.log(`Received stop typing from ${sender}`);
    if (sender === currentFriend) {
        const typingIndicator = document.getElementById("typingIndicator");
        if (typingIndicator) {
            typingIndicator.classList.remove("active");
            console.log("Typing indicator hidden");
        } else {
            console.error("Typing indicator element not found!");
        }
    }
});

connection.on("ReceiveUnreadCounts", (unreadCounts) => {
    console.log("Unread counts:", unreadCounts);
    const friendList = document.getElementById("friendList").getElementsByTagName("li");
    for (let item of friendList) {
        const username = item.dataset.username;
        const countSpan = item.querySelector(".unread-count");
        if (unreadCounts[username] && unreadCounts[username] > 0) {
            if (!countSpan) {
                const span = document.createElement("span");
                span.className = "unread-count";
                span.textContent = unreadCounts[username];
                item.appendChild(span);
            } else {
                countSpan.textContent = unreadCounts[username];
            }
        } else if (countSpan) {
            countSpan.remove();
        }
    }
});

connection.on("ReceiveUserStatus", (username, isOnline) => {
    const friendItems = document.getElementById("friendList").getElementsByTagName("li");
    for (let item of friendItems) {
        if (item.dataset.username === username) {
            const dot = item.querySelector(".status-dot");
            const offlineSpan = item.querySelector(".last-offline");
            dot.className = `status-dot ${isOnline ? "online" : "offline"}`;
            if (isOnline) {
                offlineSpan.textContent = "";
            } else {
                connection.invoke("GetLastOnline", currentUser, username).catch(err => console.error("Error getting last online:", err));
            }

            if (username === currentFriend) {
                const statusDot = document.getElementById("chatUserStatus");
                if (statusDot) {
                    statusDot.className = `status-dot ${isOnline ? "online" : "offline"}`;
                }
            }
            break;
        }
    }
});

connection.on("ReceiveFriends", (friends, friendStatuses) => {
    friendsList = friends;
    const friendList = document.getElementById("friendList");
    friendList.innerHTML = "";
    friends.sort((a, b) => a.localeCompare(b));
    friends.forEach(friend => {
        const li = document.createElement("li");
        li.className = "p-2 cursor-pointer";
        li.dataset.username = friend;
        li.innerHTML = `
            ${friend}
            <span class="status-dot ${friendStatuses[friend] ? "online" : "offline"}"></span>
            <span class="last-offline"></span>
        `;
        if (!friendStatuses[friend]) {
            connection.invoke("GetLastOnline", currentUser, friend).catch(err => console.error("Error getting last online:", err));
        }
        li.onclick = () => {
            currentFriend = friend;
            localStorage.setItem("currentFriend", currentFriend);

            document.getElementById("chat-intro").textContent = `Chat with ${friend}`;

            const avatarContainer = document.getElementById("chatUserAvatarContainer");
            const avatarImg = document.getElementById("chatUserAvatar");
            const statusDot = document.getElementById("chatUserStatus");

            avatarContainer.classList.remove("d-none");

            avatarImg.src = `/images/avatars/${friend}.jpg`;
            avatarImg.onerror = () => {
                avatarImg.src = '/images/avatars/default.jpg';
            };

            const isOnline = friendStatuses[friend];
            statusDot.className = `status-dot ${isOnline ? "online" : "offline"}`;

            document.getElementById("messagesList").innerHTML = "";
            oldestMessageId = null;
            const loadingSpinner = document.getElementById("loadingSpinner");
            if (loadingSpinner) {
                loadingSpinner.classList.add("active");
            }

            const pendingMessages = JSON.parse(localStorage.getItem("pendingMessages") || "{}");
            if (pendingMessages[friend]) {
                pendingMessages[friend].forEach(msg => {
                    connection.invoke("ReceiveMessage", msg.sender, msg.message, msg.receiver, msg.messageType, msg.fileUrl, msg.isPinned, msg.messageId, msg.timestamp, msg.fileSize);
                });
                delete pendingMessages[friend];
                localStorage.setItem("pendingMessages", JSON.stringify(pendingMessages));
            }

            connection.invoke("LoadMessages", currentUser, friend).catch(err => {
                console.error("Error loading messages:", err);
            }).finally(() => {
                if (loadingSpinner) {
                    loadingSpinner.classList.remove("active");
                }
                const messagesList = document.getElementById("messagesList");
                const scrollToBottom = (retryCount = 0) => {
                    setTimeout(() => {
                        const lastMessage = messagesList.lastElementChild;
                        if (lastMessage) {
                            lastMessage.scrollIntoView({ behavior: "smooth", block: "end" });
                            console.log(`Scroll height after loading messages: ${messagesList.scrollHeight}, ScrollTop: ${messagesList.scrollTop}, ClientHeight: ${messagesList.clientHeight}`);
                        }
                        setTimeout(() => {
                            if (messagesList.scrollTop + messagesList.clientHeight < messagesList.scrollHeight - 50 && retryCount < 3) {
                                console.log(`Scroll to bottom failed after loading messages, retrying (${retryCount + 1})...`);
                                scrollToBottom(retryCount + 1);
                            }
                        }, 100);
                    }, 300);
                };
                scrollToBottom();

                const messageElements = messagesList.querySelectorAll(".message");
                messageElements.forEach(msg => observer.observe(msg));
            });
        };
        friendList.appendChild(li);
    });
    connection.invoke("GetUnreadCounts", currentUser);
});

connection.on("ReceiveFriendRequests", (requests) => {
    const friendRequests = document.getElementById("friendRequests");
    friendRequests.innerHTML = requests.length > 0 ? "<h6>Friend Requests</h6>" : "";
    requests.forEach(requester => {
        const div = document.createElement("div");
        div.className = "request-item";
        div.innerHTML = `
            <span>${requester}</span>
            <button class="btn btn-success btn-sm">Accept</button>
        `;
        div.querySelector("button").onclick = () => {
            connection.invoke("AcceptFriendRequest", currentUser, requester).catch(err => console.error(err));
        };
        friendRequests.appendChild(div);
    });
});

connection.on("ReceiveFriendRequest", (sender) => {
    document.getElementById("friendRequestSender").textContent = sender;
    const friendRequestModal = document.getElementById("friendRequestModal");
    if (friendRequestModal) {
        friendRequestModal.classList.remove("d-none");
    }

    document.getElementById("acceptFriendRequestButton").onclick = () => {
        if (friendRequestModal) {
            friendRequestModal.classList.add("d-none");
        }
        connection.invoke("AcceptFriendRequest", currentUser, sender).catch(err => console.error(err));
    };

    document.getElementById("declineFriendRequestButton").onclick = () => {
        if (friendRequestModal) {
            friendRequestModal.classList.add("d-none");
        }
        connection.invoke("DeclineFriendRequest", currentUser, sender).catch(err => console.error(err));
    };
});

connection.on("FriendRequestAccepted", (friend) => {
    connection.invoke("GetFriends", currentUser).catch(err => console.error(err));
    connection.invoke("GetFriendRequests", currentUser).catch(err => console.error(err));
});

connection.on("FriendRequestDeclined", (decliner) => {
    connection.invoke("GetFriends", currentUser).catch(err => console.error(err));
    connection.invoke("GetFriendRequests", currentUser).catch(err => console.error(err));
});

connection.on("ReceiveError", (message) => {
    console.log("Error received:", message);
    alert(message);
});

connection.on("ReceiveSuccess", (message) => {
    console.log("Success received:", message);
    alert(message);
});

connection.on("ReceiveLastOnline", (friend, lastOnline) => {
    console.log(`Received LastOnline for ${friend}: ${lastOnline}`);
    const friendItems = document.getElementById("friendList").getElementsByTagName("li");
    for (let item of friendItems) {
        if (item.dataset.username === friend) {
            const offlineSpan = item.querySelector(".last-offline");
            if (lastOnline) {
                const lastOnlineDate = new Date(lastOnline);
                console.log(`Parsed LastOnline for ${friend}: ${lastOnlineDate}`);
                updateLastOfflineTime(offlineSpan, lastOnlineDate);
            }
            break;
        }
    }
});

function updateLastOfflineTime(element, lastOnline) {
    const now = new Date();
    console.log(`Current time: ${now}, LastOnline: ${lastOnline}`);
    const diff = Math.round((now - lastOnline) / 60000); // diff in minutes
    if (diff < 1) {
        element.textContent = "Offline just now";
    } else if (diff < 60) {
        element.textContent = `Offline ${diff} mins ago`;
    } else if (diff < 1440) {
        const hours = Math.round(diff / 60);
        element.textContent = `Offline ${hours} hours ago`;
    } else if (diff < 10080) {
        const days = Math.round(diff / 1440);
        element.textContent = `Offline ${days} days ago`;
    } else {
        const weeks = Math.round(diff / 10080);
        element.textContent = `Offline ${weeks} weeks ago`;
    }
}

document.getElementById("searchUser").addEventListener("input", async () => {
    const query = document.getElementById("searchUser").value.trim();
    if (query) {
        console.log(`Searching for users with query: ${query}`);
        const response = await fetch(`/User/SearchUsers?query=${encodeURIComponent(query)}`);
        const data = await response.json();
        console.log("Search results:", data);
        const searchResults = document.getElementById("searchResults");
        searchResults.innerHTML = "";
        data.users.forEach(user => {
            const div = document.createElement("div");
            div.className = "user-item";
            const isFriend = friendsList.includes(user);
            div.innerHTML = `
                <span>${user}</span>
                ${isFriend ? '<button class="btn btn-secondary btn-sm">Chat</button>' : '<button class="btn btn-primary btn-sm"><i class="fas fa-user-plus"></i></button>'}
            `;
            if (isFriend) {
                div.querySelector("button").onclick = () => {
                    currentFriend = user;
                    localStorage.setItem("currentFriend", currentFriend);
                    document.getElementById("chat-intro").textContent = `Chat with ${user}`;
                    document.getElementById("messagesList").innerHTML = "";
                    oldestMessageId = null;
                    const loadingSpinner = document.getElementById("loadingSpinner");
                    if (loadingSpinner) {
                        loadingSpinner.classList.add("active");
                    }

                    const pendingMessages = JSON.parse(localStorage.getItem("pendingMessages") || "{}");
                    if (pendingMessages[user]) {
                        pendingMessages[user].forEach(msg => {
                            connection.invoke("ReceiveMessage", msg.sender, msg.message, msg.receiver, msg.messageType, msg.fileUrl, msg.isPinned, msg.messageId, msg.timestamp, msg.fileSize);
                        });
                        delete pendingMessages[user];
                        localStorage.setItem("pendingMessages", JSON.stringify(pendingMessages));
                    }

                    connection.invoke("LoadMessages", currentUser, user).catch(err => {
                        console.error("Error loading messages:", err);
                    }).finally(() => {
                        if (loadingSpinner) {
                            loadingSpinner.classList.remove("active");
                        }
                        const messagesList = document.getElementById("messagesList");
                        const scrollToBottom = (retryCount = 0) => {
                            setTimeout(() => {
                                const lastMessage = messagesList.lastElementChild;
                                if (lastMessage) {
                                    lastMessage.scrollIntoView({ behavior: "smooth", block: "end" });
                                    console.log(`Scroll height after loading messages: ${messagesList.scrollHeight}, ScrollTop: ${messagesList.scrollTop}, ClientHeight: ${messagesList.clientHeight}`);
                                }
                                setTimeout(() => {
                                    if (messagesList.scrollTop + messagesList.clientHeight < messagesList.scrollHeight - 50 && retryCount < 3) {
                                        console.log(`Scroll to bottom failed after loading messages, retrying (${retryCount + 1})...`);
                                        scrollToBottom(retryCount + 1);
                                    }
                                }, 100);
                            }, 300);
                        };
                        scrollToBottom();

                        const messageElements = messagesList.querySelectorAll(".message");
                        messageElements.forEach(msg => observer.observe(msg));
                    });
                };
            } else {
                div.querySelector("button").onclick = () => {
                    console.log(`Sending friend request from ${currentUser} to ${user}`);
                    connection.invoke("SendFriendRequest", currentUser, user).catch(err => {
                        console.error("Error sending friend request:", err);
                    });
                };
            }
            searchResults.appendChild(div);
        });
    } else {
        document.getElementById("searchResults").innerHTML = "";
    }
});

document.getElementById("sendButton").addEventListener("click", () => {
    const message = document.getElementById("messageInput").value.trim();
    if (message && currentFriend) {
        connection.invoke("SendMessage", currentUser, currentFriend, message).catch(err => console.error(err));
        document.getElementById("messageInput").value = "";
        connection.invoke("StopTyping", currentUser, currentFriend);
    }
});

document.getElementById("messageInput").addEventListener("keypress", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        document.getElementById("sendButton").click();
    }
});

document.getElementById("messageInput").addEventListener("input", () => {
    if (currentFriend) {
        console.log(`Sending typing event to ${currentFriend}`);
        connection.invoke("SendTyping", currentUser, currentFriend).catch(err => console.error("Error sending typing:", err));
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            console.log(`Sending stop typing event to ${currentFriend}`);
            connection.invoke("StopTyping", currentUser, currentFriend).catch(err => console.error("Error stopping typing:", err));
        }, 2000);
    }
});

document.getElementById("fileButton").addEventListener("click", () => {
    document.getElementById("fileInput").click();
});

document.getElementById("fileInput").addEventListener("change", async () => {
    const file = document.getElementById("fileInput").files[0];
    if (file && currentFriend) {
        const formData = new FormData();
        formData.append("file", file);
        const fileSize = file.size; // Lấy kích thước file tại client
        const response = await fetch("/api/upload", {
            method: "POST",
            body: formData
        });
        const data = await response.json();
        if (data.fileUrl) {
            const messageType = file.type.startsWith("image/") ? "Image" : "File";
            connection.invoke("SendFileMessage", currentUser, currentFriend, data.fileUrl, messageType, fileSize);
        }
    }
});

async function startVideoCall(targetUser) {
    if (peer || localStream) {
        alert("A call is already in progress. Please end the current call first.");
        return;
    }

    if (connection.state !== signalR.HubConnectionState.Connected) {
        alert("Cannot start a call because the server connection is not active. Retrying connection...");
        await startConnection();
        return;
    }

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const localVideo = document.getElementById("localVideo");
        if (localVideo) {
            localVideo.srcObject = localStream;
        }
        const localUserLabel = document.getElementById("localUserLabel");
        if (localUserLabel) {
            localUserLabel.textContent = currentUser;
        }
        const remoteUserLabel = document.getElementById("remoteUserLabel");
        if (remoteUserLabel) {
            remoteUserLabel.textContent = targetUser;
        }
        const videoContainer = document.getElementById("videoContainer");
        if (videoContainer) {
            videoContainer.classList.remove("d-none");
        }

        remoteUser = targetUser;

        peer = new SimplePeer({
            initiator: true,
            trickle: false,
            stream: localStream
        });

        peer.on("signal", data => {
            console.log("Sending signal to " + targetUser);
            if (connection.state === signalR.HubConnectionState.Connected) {
                connection.invoke("SendSignal", targetUser, JSON.stringify(data)).catch(err => {
                    console.error("Error sending signal:", err);
                    alert("Failed to send call signal. Please try again.");
                    endCall();
                });
            } else {
                alert("Cannot send call signal because the server connection is not active.");
                endCall();
            }
        });

        peer.on("stream", stream => {
            console.log("Received remote stream");
            const remoteVideo = document.getElementById("remoteVideo");
            if (remoteVideo) {
                remoteVideo.srcObject = stream;
            }
        });

        peer.on("error", err => {
            console.error("Peer error:", err);
            alert("An error occurred during the call: " + err.message);
            endCall();
        });

        peer.on("close", () => {
            console.log("Peer connection closed");
            endCall();
        });

    } catch (err) {
        console.error("Error accessing media devices:", err);
        alert("Unable to access camera or microphone. Please check your permissions or device settings.");
        endCall();
    }
}

connection.on("ReceiveSignal", async (sender, signalData) => {
    console.log("Received signal from " + sender);

    if (connection.state !== signalR.HubConnectionState.Connected) {
        console.error("Cannot process signal because SignalR connection is not active.");
        return;
    }

    if (!peer) {
        incomingCaller = sender;
        const callerName = document.getElementById("callerName");
        if (callerName) {
            callerName.textContent = sender;
        }
        const callModal = document.getElementById("callModal");
        if (callModal) {
            callModal.classList.remove("d-none");
        } else {
            console.error("Call modal element not found!");
            return;
        }

        document.getElementById("acceptCallButton").onclick = async () => {
            if (callModal) {
                callModal.classList.add("d-none");
            }
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                const localVideo = document.getElementById("localVideo");
                if (localVideo) {
                    localVideo.srcObject = localStream;
                }
                const localUserLabel = document.getElementById("localUserLabel");
                if (localUserLabel) {
                    localUserLabel.textContent = currentUser;
                }
                const remoteUserLabel = document.getElementById("remoteUserLabel");
                if (remoteUserLabel) {
                    remoteUserLabel.textContent = sender;
                }
                const videoContainer = document.getElementById("videoContainer");
                if (videoContainer) {
                    videoContainer.classList.remove("d-none");
                }

                remoteUser = sender;

                peer = new SimplePeer({
                    initiator: false,
                    trickle: false,
                    stream: localStream
                });

                peer.on("signal", data => {
                    console.log("Sending response signal to " + sender);
                    if (connection.state === signalR.HubConnectionState.Connected) {
                        connection.invoke("SendSignal", sender, JSON.stringify(data)).catch(err => {
                            console.error("Error sending response signal:", err);
                            alert("Failed to send response signal. Please try again.");
                            endCall();
                        });
                    } else {
                        alert("Cannot send response signal because the server connection is not active.");
                        endCall();
                    }
                });

                peer.on("stream", stream => {
                    console.log("Received remote stream");
                    const remoteVideo = document.getElementById("remoteVideo");
                    if (remoteVideo) {
                        remoteVideo.srcObject = stream;
                    }
                });

                peer.on("error", err => {
                    console.error("Peer error:", err);
                    alert("An error occurred during the call: " + err.message);
                    endCall();
                });

                peer.on("close", () => {
                    console.log("Peer connection closed");
                    endCall();
                });

                peer.signal(JSON.parse(signalData));
            } catch (err) {
                console.error("Error accessing media devices:", err);
                alert("Unable to access camera or microphone. Please check your permissions or device settings.");
                endCall();
            }
        };

        document.getElementById("declineCallButton").onclick = () => {
            if (callModal) {
                callModal.classList.add("d-none");
            }
            connection.invoke("SendCallEnded", sender).catch(err => console.error(err));
            incomingCaller = null;
        };
    } else {
        try {
            peer.signal(JSON.parse(signalData));
        } catch (err) {
            console.error("Error processing signal data:", err);
            alert("Failed to process call signal. Please try again.");
            endCall();
        }
    }
});

connection.on("CallEnded", () => {
    endCall();
});

function endCall() {
    if (peer) {
        peer.destroy();
        peer = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    const localVideo = document.getElementById("localVideo");
    if (localVideo) {
        localVideo.srcObject = null;
    }
    const remoteVideo = document.getElementById("remoteVideo");
    if (remoteVideo) {
        remoteVideo.srcObject = null;
    }
    const videoContainer = document.getElementById("videoContainer");
    if (videoContainer) {
        videoContainer.classList.add("d-none");
    }
    if (incomingCaller || remoteUser) {
        const target = incomingCaller || remoteUser;
        if (connection.state === signalR.HubConnectionState.Connected) {
            connection.invoke("SendCallEnded", target).catch(err => console.error(err));
        }
        incomingCaller = null;
        remoteUser = null;
    }
}

document.getElementById("startVideoCall").addEventListener("click", () => {
    if (currentFriend) {
        startVideoCall(currentFriend);
    } else {
        alert("Please select a friend to call.");
    }
});

document.getElementById("endCallButton").addEventListener("click", () => {
    endCall();
});