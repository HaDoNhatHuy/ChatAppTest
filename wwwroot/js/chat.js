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
let isVideoCall = false;
let callStartTime = null;
let callTimerInterval = null;

// Hàm format thời gian ghi âm
function formatRecordingTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return "Error";
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}

// Hàm format thời gian cuộc gọi
function formatCallDuration(seconds) {
    const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const mins = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return hours > 0 ? `${hours}:${mins}:${secs}` : `${mins}:${secs}`;
}

// IntersectionObserver để phát hiện tin nhắn hiển thị
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const messageElement = entry.target;
            const messageId = parseInt(messageElement.dataset.messageId);
            const isReceiver = messageElement.classList.contains("received");

            if (isReceiver && messageElement.dataset.seen === "false") {
                connection.invoke("MarkMessageAsSeen", messageId, currentUser).catch(err => {
                    console.error("Lỗi đánh dấu tin nhắn đã xem:", err);
                });
            }
        }
    });
}, { threshold: 0.5 });

document.addEventListener("DOMContentLoaded", async () => {
    console.log("DOM loaded, khởi tạo chat...");

    localStorage.removeItem("currentFriend");
    console.log("Đã xóa currentFriend từ localStorage khi tải trang");

    await startConnection();

    const messagesList = document.getElementById("messagesList");
    messagesList.addEventListener("scroll", async () => {
        if (messagesList.scrollTop === 0 && !isLoadingMessages && oldestMessageId) {
            isLoadingMessages = true;
            const loadingSpinner = document.getElementById("loadingSpinner");
            if (loadingSpinner) loadingSpinner.classList.add("active");

            try {
                await connection.invoke("LoadOlderMessages", currentUser, currentFriend, oldestMessageId);
            } catch (err) {
                console.error("Lỗi tải tin nhắn cũ:", err);
            } finally {
                isLoadingMessages = false;
                if (loadingSpinner) loadingSpinner.classList.remove("active");
            }
        }

        const scrollToBottomBtn = document.getElementById("scrollToBottomBtn");
        if (scrollToBottomBtn) {
            if (messagesList.scrollTop + messagesList.clientHeight < messagesList.scrollHeight - 50) {
                console.log("Hiển thị nút cuộn xuống dưới");
                scrollToBottomBtn.classList.add("active");
            } else {
                console.log("Ẩn nút cuộn xuống dưới");
                scrollToBottomBtn.classList.remove("active");
            }
        }
    });

    document.getElementById("scrollToBottomBtn").addEventListener("click", () => {
        const lastMessage = messagesList.lastElementChild;
        if (lastMessage) {
            lastMessage.scrollIntoView({ behavior: "smooth", block: "end" });
            console.log("Đã cuộn xuống dưới qua nút");
        }
        const scrollToBottomBtn = document.getElementById("scrollToBottomBtn");
        if (scrollToBottomBtn) scrollToBottomBtn.classList.remove("active");
    });

    // Toggle All Friends Panel
    document.getElementById("addFriendBtn").addEventListener("click", () => {
        const allFriendsPanel = document.getElementById("allFriendsPanel");
        allFriendsPanel.classList.toggle("active");
    });

    // Close All Friends Panel
    document.getElementById("closeAllFriendsPanel").addEventListener("click", () => {
        const allFriendsPanel = document.getElementById("allFriendsPanel");
        allFriendsPanel.classList.remove("active");
    });

    // Toggle User Info Panel
    document.getElementById("viewUserInfo").addEventListener("click", () => {
        if (currentFriend) {
            const userInfoPanel = document.getElementById("userInfoPanel");
            const userInfoAvatar = document.getElementById("userInfoAvatar");
            const userInfoStatus = document.getElementById("userInfoStatus");
            const userInfoName = document.getElementById("userInfoName");
            const userInfoUsername = document.getElementById("userInfoUsername");
            const userInfoLastOnline = document.getElementById("userInfoLastOnline");

            // Populate user info
            userInfoAvatar.src = `/images/avatars/${currentFriend}.jpg`;
            userInfoAvatar.onerror = () => {
                userInfoAvatar.src = '/images/avatars/default.jpg';
            };
            userInfoName.textContent = currentFriend;
            userInfoUsername.textContent = currentFriend;

            // Update status
            const friendItems = document.getElementById("friendList").getElementsByTagName("li");
            let isOnline = false;
            for (let item of friendItems) {
                if (item.dataset.username === currentFriend) {
                    isOnline = item.querySelector(".status-dot").classList.contains("online");
                    const lastOffline = item.querySelector(".last-offline").textContent;
                    userInfoLastOnline.textContent = lastOffline || (isOnline ? "Online" : "Offline");
                    break;
                }
            }
            userInfoStatus.className = `status-dot status-dot-large ${isOnline ? "online" : "offline"}`;

            userInfoPanel.classList.toggle("active");
        } else {
            alert("Please select a friend to view their info.");
        }
    });

    // Close User Info Panel
    document.getElementById("closeUserInfoPanel").addEventListener("click", () => {
        const userInfoPanel = document.getElementById("userInfoPanel");
        userInfoPanel.classList.remove("active");
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
        emojiPicker.style.display = "none";
    });

    document.addEventListener("click", (event) => {
        if (!emojiPicker.contains(event.target) && !emojiButton.contains(event.target)) {
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
                        const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
                        const arrayBuffer = await audioBlob.arrayBuffer();
                        const audioContext = new AudioContext();
                        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

                        const wav = audioBuffer.getChannelData(0);
                        const mp3Encoder = new lamejs.Mp3Encoder(1, audioBuffer.sampleRate, 128);
                        const mp3Data = [];
                        const samples = new Int16Array(wav.length);
                        for (let i = 0; i < wav.length; i++) {
                            samples[i] = wav[i] * 32767;
                        }
                        const mp3Buffer = mp3Encoder.encodeBuffer(samples);
                        const endBuffer = mp3Encoder.flush();
                        mp3Data.push(mp3Buffer);
                        mp3Data.push(endBuffer);

                        const mp3Blob = new Blob(mp3Data, { type: 'audio/mp3' });
                        const fileSize = mp3Blob.size;
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
                    }
                }, 120000);

                isRecording = true;
                voiceButton.innerHTML = '<i class="fas fa-stop"></i>';
                voiceButton.title = "Stop Recording";
            } catch (err) {
                console.error("Lỗi truy cập microphone:", err);
                toastr.error("Không thể truy cập microphone. Vui lòng kiểm tra quyền truy cập.");
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

    // Sự kiện cho các nút điều khiển cuộc gọi
    const toggleMuteButton = document.getElementById("toggleMuteButton");
    const toggleMuteButtonVoice = document.getElementById("toggleMuteButtonVoice");
    const toggleVideoButton = document.getElementById("toggleVideoButton");
    const endCallButton = document.getElementById("endCallButton");
    const endCallButtonVoice = document.getElementById("endCallButtonVoice");

    // Xử lý bật/tắt âm thanh cho video call
    toggleMuteButton.addEventListener("click", () => {
        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                toggleMuteButton.innerHTML = audioTrack.enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
                toggleMuteButton.title = audioTrack.enabled ? "Mute" : "Unmute";
            }
        }
    });

    // Xử lý bật/tắt âm thanh cho voice call
    toggleMuteButtonVoice.addEventListener("click", () => {
        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                toggleMuteButtonVoice.innerHTML = audioTrack.enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
                toggleMuteButtonVoice.title = audioTrack.enabled ? "Mute" : "Unmute";
            }
        }
    });

    // Xử lý bật/tắt video
    toggleVideoButton.addEventListener("click", () => {
        if (localStream) {
            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                toggleVideoButton.innerHTML = videoTrack.enabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
                toggleVideoButton.title = videoTrack.enabled ? "Turn Camera Off" : "Turn Camera On";
            }
        }
    });

    // Xử lý kết thúc cuộc gọi (video call)
    endCallButton.addEventListener("click", () => {
        endCall();
    });

    // Xử lý kết thúc cuộc gọi (voice call)
    endCallButtonVoice.addEventListener("click", () => {
        endCall();
    });
});

async function startConnection() {
    try {
        if (connection.state === signalR.HubConnectionState.Connected) {
            console.log("Kết nối SignalR đã được thiết lập.");
            return;
        }

        if (connection.state !== signalR.HubConnectionState.Disconnected) {
            console.log(`Kết nối SignalR đang ở trạng thái ${connection.state}. Đang dừng kết nối hiện tại...`);
            await connection.stop();
        }

        console.log("Đang thử khởi tạo kết nối SignalR...");
        await connection.start();
        console.log("Đã kết nối SignalR.");

        await Promise.all([
            connection.invoke("GetFriends", currentUser),
            connection.invoke("GetFriendRequests", currentUser),
            connection.invoke("GetUnreadCounts", currentUser)
        ]);
    } catch (err) {
        console.error("Lỗi khởi tạo kết nối SignalR:", err);
        alert("Không thể kết nối đến máy chủ. Thử lại sau 5 giây...");
        setTimeout(startConnection, 5000);
        throw err;
    }
}

connection.onclose(async (error) => {
    console.log("Kết nối SignalR đã đóng. Lỗi:", error);
    alert("Mất kết nối với máy chủ. Đang thử kết nối lại...");
    await startConnection();
});

// Cập nhật thời gian cuộc gọi khi cuộc gọi được chấp nhận
connection.on("CallAccepted", (caller) => {
    if (caller === remoteUser || caller === incomingCaller) {
        startCallTimer();
    }
});

// Hàm bắt đầu đếm thời gian cuộc gọi
function startCallTimer() {
    if (callTimerInterval) {
        clearInterval(callTimerInterval);
    }
    callStartTime = new Date();
    const callTimer = document.getElementById("callTimer");
    callTimerInterval = setInterval(() => {
        const now = new Date();
        const seconds = Math.floor((now - callStartTime) / 1000);
        callTimer.textContent = formatCallDuration(seconds);
    }, 1000);
}

connection.on("ReceiveMessage", (sender, message, receiver, messageType = "Text", fileUrl = null, isPinned = false, messageId, timestamp, fileSize = 0) => {
    console.log(`Nhận tin nhắn: Sender=${sender}, Receiver=${receiver}, Content=${message}, Type=${messageType}, ID=${messageId}, Timestamp=${timestamp}, FileSize=${fileSize}`);
    if ((sender === currentFriend && receiver === currentUser) || (sender === currentUser && receiver === currentFriend)) {
        const messagesList = document.getElementById("messagesList");
        if (!messagesList) {
            console.error("Không tìm thấy danh sách tin nhắn!");
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
                    <img src="${fileUrl}" alt="Hình ảnh" />
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
                            <a href="${fileUrl}" class="file-link" target="_blank">Tải xuống</a>
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
                        Trình duyệt của bạn không hỗ trợ phát âm thanh.
                    </audio>
                </div>
            `;
        }

        li.innerHTML = `
            <img src="/images/avatars/${sender}.jpg" class="avatar" onerror="this.src='/images/avatars/default.jpg'" />
            <div class="content">
                <span>${content}</span>
                <small>${messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                ${sender === currentUser ? `<small class="seen-indicator text-success" style="display: none;" title="Đã xem"><i class="fas fa-check-double"></i></small>` : ""}
                <button class="pin-button btn btn-sm btn-outline-secondary">${isPinned ? "Bỏ ghim" : "Ghim"}</button>
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

            audio.onerror = () => {
                console.error(`Không thể tải âm thanh từ ${fileUrl}`);
                durationSpan.textContent = "Lỗi";
                durationSpan.style.color = "red";
            };

            audio.onloadedmetadata = () => {
                const duration = audio.duration;
                console.log(`Thời lượng âm thanh cho ${fileUrl}: ${duration} giây`);
                if (!isFinite(duration) || duration <= 0) {
                    durationSpan.textContent = "Lỗi";
                    durationSpan.style.color = "red";
                } else {
                    durationSpan.textContent = formatRecordingTime(Math.round(duration));
                }
            };

            audio.load();

            playButton.addEventListener('click', (event) => {
                event.stopPropagation();
                if (audio.paused) {
                    audio.play().catch(err => {
                        console.error(`Lỗi phát âm thanh từ ${fileUrl}:`, err);
                        toastr.error("Không thể phát âm thanh. Vui lòng kiểm tra file.");
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
            img.addEventListener('click', (event) => {
                event.stopPropagation();
                const lightbox = document.createElement('div');
                lightbox.className = 'image-lightbox';
                lightbox.innerHTML = `
                    <div class="lightbox-content">
                        <img src="${fileUrl}" alt="Hình ảnh" class="lightbox-image" />
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
                    console.log(`Đã cuộn xuống dưới. ScrollHeight: ${messagesList.scrollHeight}, ScrollTop: ${messagesList.scrollTop}, ClientHeight: ${messagesList.clientHeight}`);
                }
                setTimeout(() => {
                    if (messagesList.scrollTop + messagesList.clientHeight < messagesList.scrollHeight - 50 && retryCount < 3) {
                        console.log(`Cuộn xuống dưới thất bại, thử lại (${retryCount + 1})...`);
                        scrollToBottom(retryCount + 1);
                    }
                }, 100);

                const scrollToBottomBtn = document.getElementById("scrollToBottomBtn");
                if (scrollToBottomBtn) {
                    if (messagesList.scrollTop + messagesList.clientHeight < messagesList.scrollHeight - 50) {
                        console.log("Hiển thị nút cuộn xuống dưới");
                        scrollToBottomBtn.classList.add("active");
                    } else {
                        console.log("Ẩn nút cuộn xuống dưới");
                        scrollToBottomBtn.classList.remove("active");
                    }
                }
            }, 300);
        };

        scrollToBottom();

        li.addEventListener("click", (event) => {
            if (
                event.target.closest(".image-message-container") ||
                event.target.closest(".voice-message-container") ||
                event.target.closest(".pin-button")
            ) {
                return;
            }

            const lastMessage = messagesList.lastElementChild;
            if (lastMessage) {
                lastMessage.scrollIntoView({ behavior: "smooth", block: "end" });
                console.log("Đã cuộn xuống dưới khi nhấn tin nhắn");
            }
            const scrollToBottomBtn = document.getElementById("scrollToBottomBtn");
            if (scrollToBottomBtn) scrollToBottomBtn.classList.remove("active");
        });

        li.querySelector(".pin-button").addEventListener("click", (event) => {
            event.stopPropagation();
            if (isPinned) {
                connection.invoke("UnpinMessage", currentUser, messageId).catch(err => console.error("Lỗi bỏ ghim tin nhắn:", err));
            } else {
                connection.invoke("PinMessage", currentUser, messageId).catch(err => console.error("Lỗi ghim tin nhắn:", err));
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
    console.log(`Nhận tin nhắn cũ: ${messages.length} tin nhắn`);
    const messagesList = document.getElementById("messagesList");
    if (!messagesList) {
        console.error("Không tìm thấy danh sách tin nhắn!");
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
                    <img src="${msg.FileUrl}" alt="Hình ảnh" />
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
                            <a href="${msg.FileUrl}" class="file-link" target="_blank">Tải xuống</a>
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
                        Trình duyệt của bạn không hỗ trợ phát âm thanh.
                    </audio>
                </div>
            `;
        }

        li.innerHTML = `
            <img src="/images/avatars/${msg.Sender}.jpg" class="avatar" onerror="this.src='/images/avatars/default.jpg'" />
            <div class="content">
                <span>${content}</span>
                <small>${messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                ${msg.Sender === currentUser ? `<small class="seen-indicator text-success" style="display: ${msg.IsSeen ? 'inline' : 'none'};" title="Đã xem"><i class="fas fa-check-double"></i></small>` : ""}
                <button class="pin-button btn btn-sm btn-outline-secondary">${msg.IsPinned ? "Bỏ ghim" : "Ghim"}</button>
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

            audio.onerror = () => {
                console.error(`Không thể tải âm thanh từ ${msg.FileUrl}`);
                durationSpan.textContent = "Lỗi";
                durationSpan.style.color = "red";
            };

            audio.onloadedmetadata = () => {
                const duration = audio.duration;
                console.log(`Thời lượng âm thanh cho ${msg.FileUrl}: ${duration} giây`);
                if (!isFinite(duration) || duration <= 0) {
                    durationSpan.textContent = "Lỗi";
                    durationSpan.style.color = "red";
                } else {
                    durationSpan.textContent = formatRecordingTime(Math.round(duration));
                }
            };

            audio.load();

            playButton.addEventListener('click', (event) => {
                event.stopPropagation();
                if (audio.paused) {
                    audio.play().catch(err => {
                        console.error(`Lỗi phát âm thanh từ ${msg.FileUrl}:`, err);
                        toastr.error("Không thể phát âm thanh. Vui lòng kiểm tra file.");
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
            img.addEventListener('click', (event) => {
                event.stopPropagation();
                const lightbox = document.createElement('div');
                lightbox.className = 'image-lightbox';
                lightbox.innerHTML = `
                    <div class="lightbox-content">
                        <img src="${msg.FileUrl}" alt="Hình ảnh" class="lightbox-image" />
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

        li.addEventListener("click", (event) => {
            if (
                event.target.closest(".image-message-container") ||
                event.target.closest(".voice-message-container") ||
                event.target.closest(".pin-button")
            ) {
                return;
            }

            const lastMessage = messagesList.lastElementChild;
            if (lastMessage) {
                lastMessage.scrollIntoView({ behavior: "smooth", block: "end" });
                console.log("Đã cuộn xuống dưới khi nhấn tin nhắn cũ");
            }
            const scrollToBottomBtn = document.getElementById("scrollToBottomBtn");
            if (scrollToBottomBtn) scrollToBottomBtn.classList.remove("active");
        });

        li.querySelector(".pin-button").addEventListener("click", (event) => {
            event.stopPropagation();
            if (msg.IsPinned) {
                connection.invoke("UnpinMessage", currentUser, msg.Id).catch(err => console.error("Lỗi bỏ ghim tin nhắn:", err));
            } else {
                connection.invoke("PinMessage", currentUser, msg.Id).catch(err => console.error("Lỗi ghim tin nhắn:", err));
            }
        });
    });

    messagesList.scrollTop = messagesList.scrollHeight - currentScrollHeight;
});

connection.on("MessageSeen", (messageId) => {
    console.log(`Nhận MessageSeen cho tin nhắn ${messageId}`);
    const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
    if (messageElement) {
        console.log(`Cập nhật trạng thái đã xem cho tin nhắn ${messageId}`);
        messageElement.dataset.seen = "true";
        const seenIndicator = messageElement.querySelector(".seen-indicator");
        if (seenIndicator) {
            seenIndicator.style.display = "inline";
            console.log(`Hiển thị biểu tượng đã xem cho tin nhắn ${messageId}`);
        }
    }
});

connection.on("ReceiveNewMessageNotification", (sender) => {
    console.log(`Thông báo tin nhắn mới từ ${sender}`);
    if (sender !== currentFriend) {
        if ("Notification" in window) {
            const requestNotificationPermission = async () => {
                const permission = await Notification.requestPermission();
                return permission;
            };

            const sendNotification = () => {
                const notification = new Notification(`Tin nhắn mới từ ${sender}`, {
                    body: "Bạn có tin nhắn mới!",
                    icon: "/images/avatars/default.jpg"
                });
                notification.onclick = () => {
                    currentFriend = sender;
                    localStorage.setItem("currentFriend", currentFriend);
                    document.getElementById("chat-intro").textContent = `Chat với ${sender}`;
                    document.getElementById("messagesList").innerHTML = "";
                    const loadingSpinner = document.getElementById("loadingSpinner");
                    if (loadingSpinner) loadingSpinner.classList.add("active");

                    connection.invoke("LoadMessages", currentUser, sender).catch(err => {
                        console.error("Lỗi tải tin nhắn:", err);
                    }).finally(() => {
                        if (loadingSpinner) loadingSpinner.classList.remove("active");
                        const messagesList = document.getElementById("messagesList");
                        const scrollToBottom = (retryCount = 0) => {
                            setTimeout(() => {
                                const lastMessage = messagesList.lastElementChild;
                                if (lastMessage) {
                                    lastMessage.scrollIntoView({ behavior: "smooth", block: "end" });
                                    console.log(`Scroll height sau khi tải tin nhắn (thông báo): ${messagesList.scrollHeight}, ScrollTop: ${messagesList.scrollTop}, ClientHeight: ${messagesList.clientHeight}`);
                                }
                                setTimeout(() => {
                                    if (messagesList.scrollTop + messagesList.clientHeight < messagesList.scrollHeight - 50 && retryCount < 3) {
                                        console.log(`Cuộn xuống dưới thất bại sau khi tải tin nhắn (thông báo), thử lại (${retryCount + 1})...`);
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
                        console.log("Người dùng đã từ chối quyền thông báo.");
                    }
                });
            }
        }
    }
});

connection.on("MessagePinned", (messageId, isPinned) => {
    const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
    if (messageElement) {
        messageElement.classList.toggle("pinned", isPinned);
        const pinButton = messageElement.querySelector(".pin-button");
        pinButton.textContent = isPinned ? "Bỏ ghim" : "Ghim";
    }
});

connection.on("ReceiveTyping", (sender) => {
    if (sender === currentFriend) {
        const typingIndicator = document.getElementById("typingIndicator");
        if (typingIndicator) typingIndicator.classList.add("active");
    }
});

connection.on("ReceiveStopTyping", (sender) => {
    if (sender === currentFriend) {
        const typingIndicator = document.getElementById("typingIndicator");
        if (typingIndicator) typingIndicator.classList.remove("active");
    }
});

connection.on("ReceiveUnreadCounts", (unreadCounts) => {
    console.log("Số tin nhắn chưa đọc:", unreadCounts);
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
    // Cập nhật trạng thái trong danh sách Online Friends
    const friendItems = document.getElementById("friendList").getElementsByTagName("li");
    for (let item of friendItems) {
        if (item.dataset.username === username) {
            const dot = item.querySelector(".status-dot");
            const offlineSpan = item.querySelector(".last-offline");
            dot.className = `status-dot ${isOnline ? "online" : "offline"}`;
            if (isOnline) {
                offlineSpan.textContent = "";
            } else {
                connection.invoke("GetLastOnline", currentUser, username).catch(err => console.error("Lỗi lấy thời gian online cuối:", err));
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

    // Cập nhật trạng thái trong danh sách All Friends
    const allFriendItems = document.getElementById("allFriendsList").getElementsByTagName("li");
    for (let item of allFriendItems) {
        if (item.dataset.username === username) {
            const dot = item.querySelector(".status-dot");
            const offlineSpan = item.querySelector(".last-offline");
            dot.className = `status-dot ${isOnline ? "online" : "offline"}`;
            if (isOnline) {
                offlineSpan.textContent = "";
            } else {
                connection.invoke("GetLastOnline", currentUser, username).catch(err => console.error("Lỗi lấy thời gian online cuối:", err));
            }
            break;
        }
    }

    // Cập nhật lại danh sách Online Friends
    const friendList = document.getElementById("friendList");
    const allFriendsList = document.getElementById("allFriendsList");
    const sortedFriends = [...friendsList].sort((a, b) => a.localeCompare(b));
    friendList.innerHTML = ""; // Xóa danh sách hiện tại

    // Lấy trạng thái từ danh sách tất cả bạn bè
    const friendStatuses = {};
    const friendItemsAll = document.getElementById("allFriendsList").getElementsByTagName("li");
    for (let item of friendItemsAll) {
        const username = item.dataset.username;
        const dot = item.querySelector(".status-dot");
        friendStatuses[username] = dot.classList.contains("online");
    }

    // Hiển thị bạn bè online trong danh sách chính
    const onlineFriends = sortedFriends.filter(friend => friendStatuses[friend]);
    onlineFriends.forEach(friend => {
        const li = document.createElement("li");
        li.className = "p-2 cursor-pointer friend-item position-relative";
        li.dataset.username = friend;
        li.innerHTML = `
            <div class="d-flex align-items-center">
                <div class="user-avatar me-2">
                    <img src="/images/avatars/${friend}.jpg" class="rounded-circle" alt="User" width="32" height="32" onerror="this.src='/images/avatars/default.jpg'">
                </div>
                <div class="friend-info flex-grow-1">
                    ${friend}
                    <div class="last-offline text-muted small"></div>
                </div>
                <span class="status-dot ${friendStatuses[friend] ? 'online' : 'offline'}"></span>
            </div>
        `;
        li.onclick = () => {
            currentFriend = friend;
            localStorage.setItem("currentFriend", currentFriend);

            document.getElementById("chat-intro").textContent = `Chat với ${friend}`;

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
            if (loadingSpinner) loadingSpinner.classList.add("active");

            const pendingMessages = JSON.parse(localStorage.getItem("pendingMessages") || "{}");
            if (pendingMessages[friend]) {
                pendingMessages[friend].forEach(msg => {
                    connection.invoke("ReceiveMessage", msg.sender, msg.message, msg.receiver, msg.messageType, msg.fileUrl, msg.isPinned, msg.messageId, msg.timestamp, msg.fileSize);
                });
                delete pendingMessages[friend];
                localStorage.setItem("pendingMessages", JSON.stringify(pendingMessages));
            }

            connection.invoke("LoadMessages", currentUser, friend).catch(err => {
                console.error("Lỗi tải tin nhắn:", err);
            }).finally(() => {
                if (loadingSpinner) loadingSpinner.classList.remove("active");
                const messagesList = document.getElementById("messagesList");
                const scrollToBottom = (retryCount = 0) => {
                    setTimeout(() => {
                        const lastMessage = messagesList.lastElementChild;
                        if (lastMessage) {
                            lastMessage.scrollIntoView({ behavior: "smooth", block: "end" });
                            console.log(`Scroll height sau khi tải tin nhắn: ${messagesList.scrollHeight}, ScrollTop: ${messagesList.scrollTop}, ClientHeight: ${messagesList.clientHeight}`);
                        }
                        setTimeout(() => {
                            if (messagesList.scrollTop + messagesList.clientHeight < messagesList.scrollHeight - 50 && retryCount < 3) {
                                console.log(`Cuộn xuống dưới thất bại sau khi tải tin nhắn, thử lại (${retryCount + 1})...`);
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
});

connection.on("ReceiveFriends", (friends, friendStatuses) => {
    friendsList = friends;
    const friendList = document.getElementById("friendList");
    const allFriendsList = document.getElementById("allFriendsList");
    friendList.innerHTML = "";
    allFriendsList.innerHTML = "";

    // Sắp xếp bạn bè theo A-Z cho panel tất cả bạn bè
    const sortedFriends = [...friends].sort((a, b) => a.localeCompare(b));

    // Điền danh sách tất cả bạn bè (A-Z)
    sortedFriends.forEach(friend => {
        const li = document.createElement("li");
        li.className = "p-2 cursor-pointer friend-item position-relative";
        li.dataset.username = friend;
        li.innerHTML = `
            <div class="d-flex align-items-center">
                <div class="user-avatar me-2">
                    <img src="/images/avatars/${friend}.jpg" class="rounded-circle" alt="User" width="32" height="32" onerror="this.src='/images/avatars/default.jpg'">
                </div>
                <div class="friend-info flex-grow-1">
                    ${friend}
                    <div class="last-offline text-muted small"></div>
                </div>
                <span class="status-dot ${friendStatuses[friend] ? 'online' : 'offline'}" style="margin-left:10px;"></span>
            </div>
        `;
        if (!friendStatuses[friend]) {
            connection.invoke("GetLastOnline", currentUser, friend).catch(err => console.error("Lỗi lấy thời gian online cuối:", err));
        }
        // Thêm sự kiện click để mở giao diện chat
        li.onclick = () => {
            currentFriend = friend;
            localStorage.setItem("currentFriend", currentFriend);

            document.getElementById("chat-intro").textContent = `Chat với ${friend}`;

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
            if (loadingSpinner) loadingSpinner.classList.add("active");

            const pendingMessages = JSON.parse(localStorage.getItem("pendingMessages") || "{}");
            if (pendingMessages[friend]) {
                pendingMessages[friend].forEach(msg => {
                    connection.invoke("ReceiveMessage", msg.sender, msg.message, msg.receiver, msg.messageType, msg.fileUrl, msg.isPinned, msg.messageId, msg.timestamp, msg.fileSize);
                });
                delete pendingMessages[friend];
                localStorage.setItem("pendingMessages", JSON.stringify(pendingMessages));
            }

            connection.invoke("LoadMessages", currentUser, friend).catch(err => {
                console.error("Lỗi tải tin nhắn:", err);
            }).finally(() => {
                if (loadingSpinner) loadingSpinner.classList.remove("active");
                const messagesList = document.getElementById("messagesList");
                const scrollToBottom = (retryCount = 0) => {
                    setTimeout(() => {
                        const lastMessage = messagesList.lastElementChild;
                        if (lastMessage) {
                            lastMessage.scrollIntoView({ behavior: "smooth", block: "end" });
                            console.log(`Scroll height sau khi tải tin nhắn: ${messagesList.scrollHeight}, ScrollTop: ${messagesList.scrollTop}, ClientHeight: ${messagesList.clientHeight}`);
                        }
                        setTimeout(() => {
                            if (messagesList.scrollTop + messagesList.clientHeight < messagesList.scrollHeight - 50 && retryCount < 3) {
                                console.log(`Cuộn xuống dưới thất bại sau khi tải tin nhắn, thử lại (${retryCount + 1})...`);
                                scrollToBottom(retryCount + 1);
                            }
                        }, 100);
                    }, 300);
                };
                scrollToBottom();

                const messageElements = messagesList.querySelectorAll(".message");
                messageElements.forEach(msg => observer.observe(msg));
            });

            // Đóng panel All Friends sau khi chọn
            const allFriendsPanel = document.getElementById("allFriendsPanel");
            allFriendsPanel.classList.remove("active");
        };
        allFriendsList.appendChild(li);
    });

    // Chỉ hiển thị bạn bè online trong danh sách chính
    const onlineFriends = sortedFriends.filter(friend => friendStatuses[friend]);
    onlineFriends.forEach(friend => {
        const li = document.createElement("li");
        li.className = "p-2 cursor-pointer friend-item position-relative";
        li.dataset.username = friend;
        li.innerHTML = `
            <div class="d-flex align-items-center">
                <div class="user-avatar me-2">
                    <img src="/images/avatars/${friend}.jpg" class="rounded-circle" alt="User" width="32" height="32" onerror="this.src='/images/avatars/default.jpg'">
                </div>
                <div class="friend-info flex-grow-1">
                    ${friend}
                    <div class="last-offline text-muted small"></div>
                </div>
                <span class="status-dot ${friendStatuses[friend] ? 'online' : 'offline'}"></span>
            </div>
        `;
        li.onclick = () => {
            currentFriend = friend;
            localStorage.setItem("currentFriend", currentFriend);

            document.getElementById("chat-intro").textContent = `Chat với ${friend}`;

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
            if (loadingSpinner) loadingSpinner.classList.add("active");

            const pendingMessages = JSON.parse(localStorage.getItem("pendingMessages") || "{}");
            if (pendingMessages[friend]) {
                pendingMessages[friend].forEach(msg => {
                    connection.invoke("ReceiveMessage", msg.sender, msg.message, msg.receiver, msg.messageType, msg.fileUrl, msg.isPinned, msg.messageId, msg.timestamp, msg.fileSize);
                });
                delete pendingMessages[friend];
                localStorage.setItem("pendingMessages", JSON.stringify(pendingMessages));
            }

            connection.invoke("LoadMessages", currentUser, friend).catch(err => {
                console.error("Lỗi tải tin nhắn:", err);
            }).finally(() => {
                if (loadingSpinner) loadingSpinner.classList.remove("active");
                const messagesList = document.getElementById("messagesList");
                const scrollToBottom = (retryCount = 0) => {
                    setTimeout(() => {
                        const lastMessage = messagesList.lastElementChild;
                        if (lastMessage) {
                            lastMessage.scrollIntoView({ behavior: "smooth", block: "end" });
                            console.log(`Scroll height sau khi tải tin nhắn: ${messagesList.scrollHeight}, ScrollTop: ${messagesList.scrollTop}, ClientHeight: ${messagesList.clientHeight}`);
                        }
                        setTimeout(() => {
                            if (messagesList.scrollTop + messagesList.clientHeight < messagesList.scrollHeight - 50 && retryCount < 3) {
                                console.log(`Cuộn xuống dưới thất bại sau khi tải tin nhắn, thử lại (${retryCount + 1})...`);
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
    friendRequests.innerHTML = requests.length > 0 ? "<h6 class='text-muted mb-2 friend-section-title'>Friend Requests</h6>" : "";
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
    if (friendRequestModal) friendRequestModal.classList.remove("d-none");

    document.getElementById("acceptFriendRequestButton").onclick = () => {
        if (friendRequestModal) friendRequestModal.classList.add("d-none");
        connection.invoke("AcceptFriendRequest", currentUser, sender).catch(err => console.error(err));
    };

    document.getElementById("declineFriendRequestButton").onclick = () => {
        if (friendRequestModal) friendRequestModal.classList.add("d-none");
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
    console.log("Lỗi nhận được:", message);
    alert(message);
});

connection.on("ReceiveSuccess", (message) => {
    console.log("Thành công nhận được:", message);
    alert(message);
});

connection.on("ReceiveLastOnline", (friend, lastOnline) => {
    console.log(`Nhận LastOnline cho ${friend}: ${lastOnline}`);

    // Cập nhật cho danh sách bạn bè online (friendList)
    const friendItems = document.getElementById("friendList").getElementsByTagName("li");
    for (let item of friendItems) {
        if (item.dataset.username === friend) {
            const offlineSpan = item.querySelector(".last-offline");
            if (lastOnline) {
                const lastOnlineDate = new Date(lastOnline);
                console.log(`Parsed LastOnline cho ${friend} trong friendList: ${lastOnlineDate}`);
                updateLastOfflineTime(offlineSpan, lastOnlineDate);
            }
            break;
        }
    }

    // Cập nhật cho danh sách tất cả bạn bè (allFriendsList)
    const allFriendItems = document.getElementById("allFriendsList").getElementsByTagName("li");
    for (let item of allFriendItems) {
        if (item.dataset.username === friend) {
            const offlineSpan = item.querySelector(".last-offline");
            if (lastOnline) {
                const lastOnlineDate = new Date(lastOnline);
                console.log(`Parsed LastOnline cho ${friend} trong allFriendsList: ${lastOnlineDate}`);
                updateLastOfflineTime(offlineSpan, lastOnlineDate);
            }
            break;
        }
    }
});

function updateLastOfflineTime(element, lastOnline) {
    const now = new Date();
    console.log(`Thời gian hiện tại: ${now}, LastOnline: ${lastOnline}`);
    const diff = Math.round((now - lastOnline) / 60000);
    if (diff < 1) {
        element.textContent = "Vừa offline";
    } else if (diff < 60) {
        element.textContent = `Offline ${diff} phút trước`;
    } else if (diff < 1440) {
        const hours = Math.round(diff / 60);
        element.textContent = `Offline ${hours} giờ trước`;
    } else if (diff < 10080) {
        const days = Math.round(diff / 1440);
        element.textContent = `Offline ${days} ngày trước`;
    } else {
        const weeks = Math.round(diff / 10080);
        element.textContent = `Offline ${weeks} tuần trước`;
    }
}

document.getElementById("searchUser").addEventListener("input", async () => {
    const query = document.getElementById("searchUser").value.trim();
    if (query) {
        console.log(`Tìm kiếm người dùng với query: ${query}`);
        const response = await fetch(`/User/SearchUsers?query=${encodeURIComponent(query)}`);
        const data = await response.json();
        console.log("Kết quả tìm kiếm:", data);
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
                    document.getElementById("chat-intro").textContent = `Chat với ${user}`;
                    document.getElementById("messagesList").innerHTML = "";
                    oldestMessageId = null;
                    const loadingSpinner = document.getElementById("loadingSpinner");
                    if (loadingSpinner) loadingSpinner.classList.add("active");

                    const pendingMessages = JSON.parse(localStorage.getItem("pendingMessages") || "{}");
                    if (pendingMessages[user]) {
                        pendingMessages[user].forEach(msg => {
                            connection.invoke("ReceiveMessage", msg.sender, msg.message, msg.receiver, msg.messageType, msg.fileUrl, msg.isPinned, msg.messageId, msg.timestamp, msg.fileSize);
                        });
                        delete pendingMessages[user];
                        localStorage.setItem("pendingMessages", JSON.stringify(pendingMessages));
                    }

                    connection.invoke("LoadMessages", currentUser, user).catch(err => {
                        console.error("Lỗi tải tin nhắn:", err);
                    }).finally(() => {
                        if (loadingSpinner) loadingSpinner.classList.remove("active");
                        const messagesList = document.getElementById("messagesList");
                        const scrollToBottom = (retryCount = 0) => {
                            setTimeout(() => {
                                const lastMessage = messagesList.lastElementChild;
                                if (lastMessage) {
                                    lastMessage.scrollIntoView({ behavior: "smooth", block: "end" });
                                    console.log(`Scroll height sau khi tải tin nhắn: ${messagesList.scrollHeight}, ScrollTop: ${messagesList.scrollTop}, ClientHeight: ${messagesList.clientHeight}`);
                                }
                                setTimeout(() => {
                                    if (messagesList.scrollTop + messagesList.clientHeight < messagesList.scrollHeight - 50 && retryCount < 3) {
                                        console.log(`Cuộn xuống dưới thất bại sau khi tải tin nhắn, thử lại (${retryCount + 1})...`);
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
                    console.log(`Gửi lời mời kết bạn từ ${currentUser} đến ${user}`);
                    connection.invoke("SendFriendRequest", currentUser, user).catch(err => {
                        console.error("Lỗi gửi lời mời kết bạn:", err);
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
        console.log(`Gửi sự kiện đang gõ đến ${currentFriend}`);
        connection.invoke("SendTyping", currentUser, currentFriend).catch(err => console.error("Lỗi gửi đang gõ:", err));
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            console.log(`Gửi sự kiện dừng gõ đến ${currentFriend}`);
            connection.invoke("StopTyping", currentUser, currentFriend).catch(err => console.error("Lỗi dừng gõ:", err));
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
        const fileSize = file.size;
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

async function startCall(targetUser, videoEnabled = false) {
    if (peer || localStream) {
        alert("There is already an ongoing call. Please end the current call first.");
        return;
    }

    if (connection.state !== signalR.HubConnectionState.Connected) {
        alert("Cannot start the call because the server connection is not active. Retrying connection...");
        await startConnection();
        return;
    }

    try {
        isVideoCall = videoEnabled;
        const constraints = { video: videoEnabled, audio: true };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);

        // Cập nhật giao diện
        const videoContainer = document.getElementById("videoContainer");
        const voiceCallContainer = document.getElementById("voiceCallContainer");
        const localVideo = document.getElementById("localVideo");
        const remoteVideo = document.getElementById("remoteVideo");
        const localUserLabel = document.getElementById("localUserLabel");
        const remoteUserLabel = document.getElementById("remoteUserLabel");
        const localAvatar = document.getElementById("localAvatar");
        const remoteAvatar = document.getElementById("remoteAvatar");
        const callTimer = document.getElementById("callTimer");

        if (videoEnabled) {
            videoContainer.classList.remove("d-none");
            voiceCallContainer.classList.add("d-none");
            localVideo.srcObject = localStream;
        } else {
            voiceCallContainer.classList.remove("d-none");
            videoContainer.classList.add("d-none");
            localAvatar.src = `/images/avatars/${currentUser}.jpg`;
            localAvatar.onerror = () => { localAvatar.src = '/images/avatars/default.jpg'; };
            remoteAvatar.src = `/images/avatars/${targetUser}.jpg`;
            remoteAvatar.onerror = () => { remoteAvatar.src = '/images/avatars/default.jpg'; };
        }

        localUserLabel.textContent = currentUser;
        remoteUserLabel.textContent = targetUser;
        callTimer.textContent = "Connecting...";

        remoteUser = targetUser;

        peer = new SimplePeer({
            initiator: true,
            trickle: false,
            stream: localStream,
            config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
        });

        peer.on("signal", data => {
            console.log("Sending signal to " + targetUser);
            if (connection.state === signalR.HubConnectionState.Connected) {
                connection.invoke("SendSignal", targetUser, JSON.stringify(data), videoEnabled).catch(err => {
                    console.error("Error sending signal:", err);
                    alert("Unable to send call signal. Please try again.");
                    endCall();
                });
            } else {
                alert("Cannot send call signal because the server connection is not active.");
                endCall();
            }
        });

        peer.on("stream", stream => {
            console.log("Receiving remote stream");
            if (isVideoCall) {
                remoteVideo.srcObject = stream;
            } else {
                // Tạo phần tử audio để phát âm thanh trong voice call
                const audio = document.createElement('audio');
                audio.id = 'remoteAudio';
                audio.srcObject = stream;
                audio.autoplay = true;
                document.body.appendChild(audio);
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
        alert("Unable to access microphone" + (videoEnabled ? " or camera" : "") + ". Please check permissions or device settings.");
        endCall();
    }
}

connection.on("ReceiveSignal", async (sender, signalData, videoEnabled) => {
    console.log("Receiving signal from " + sender + ", videoEnabled: " + videoEnabled);

    if (connection.state !== signalR.HubConnectionState.Connected) {
        console.error("Cannot process signal because SignalR connection is not active.");
        return;
    }

    if (!peer) {
        incomingCaller = sender;
        isVideoCall = videoEnabled;
        const callerName = document.getElementById("callerName");
        if (callerName) callerName.textContent = sender;
        const callModal = document.getElementById("callModal");
        if (callModal) callModal.classList.remove("d-none");

        document.getElementById("acceptCallButton").onclick = async () => {
            if (callModal) callModal.classList.add("d-none");
            try {
                const constraints = { video: isVideoCall, audio: true };
                localStream = await navigator.mediaDevices.getUserMedia(constraints);

                const videoContainer = document.getElementById("videoContainer");
                const voiceCallContainer = document.getElementById("voiceCallContainer");
                const localVideo = document.getElementById("localVideo");
                const remoteVideo = document.getElementById("remoteVideo");
                const localUserLabel = document.getElementById("localUserLabel");
                const remoteUserLabel = document.getElementById("remoteUserLabel");
                const localAvatar = document.getElementById("localAvatar");
                const remoteAvatar = document.getElementById("remoteAvatar");
                const callTimer = document.getElementById("callTimer");

                if (isVideoCall) {
                    videoContainer.classList.remove("d-none");
                    voiceCallContainer.classList.add("d-none");
                    localVideo.srcObject = localStream;
                } else {
                    voiceCallContainer.classList.remove("d-none");
                    videoContainer.classList.add("d-none");
                    localAvatar.src = `/images/avatars/${currentUser}.jpg`;
                    localAvatar.onerror = () => { localAvatar.src = '/images/avatars/default.jpg'; };
                    remoteAvatar.src = `/images/avatars/${sender}.jpg`;
                    remoteAvatar.onerror = () => { remoteAvatar.src = '/images/avatars/default.jpg'; };
                }

                localUserLabel.textContent = currentUser;
                remoteUserLabel.textContent = sender;
                callTimer.textContent = "Connecting...";

                remoteUser = sender;

                peer = new SimplePeer({
                    initiator: false,
                    trickle: false,
                    stream: localStream,
                    config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
                });

                peer.on("signal", data => {
                    console.log("Sending response signal to " + sender);
                    if (connection.state === signalR.HubConnectionState.Connected) {
                        connection.invoke("SendSignal", sender, JSON.stringify(data), isVideoCall).catch(err => {
                            console.error("Error sending response signal:", err);
                            alert("Unable to send response signal. Please try again.");
                            endCall();
                        });
                        // Gửi tín hiệu CallAccepted để đồng bộ thời gian
                        connection.invoke("CallAccepted", sender).catch(err => {
                            console.error("Error sending CallAccepted signal:", err);
                        });
                    } else {
                        alert("Cannot send response signal because the server connection is not active.");
                        endCall();
                    }
                });

                peer.on("stream", stream => {
                    console.log("Receiving remote stream");
                    if (isVideoCall) {
                        remoteVideo.srcObject = stream;
                    } else {
                        // Tạo phần tử audio để phát âm thanh trong voice call
                        const audio = document.createElement('audio');
                        audio.id = 'remoteAudio';
                        audio.srcObject = stream;
                        audio.autoplay = true;
                        document.body.appendChild(audio);
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
                alert("Unable to access microphone" + (isVideoCall ? " or camera" : "") + ". Please check permissions or device settings.");
                endCall();
            }
        };

        document.getElementById("declineCallButton").onclick = () => {
            if (callModal) callModal.classList.add("d-none");
            connection.invoke("SendCallEnded", sender).catch(err => console.error(err));
            incomingCaller = null;
        };
    } else {
        try {
            peer.signal(JSON.parse(signalData));
        } catch (err) {
            console.error("Error processing signal data:", err);
            alert("Unable to process call signal. Please try again.");
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
    const remoteVideo = document.getElementById("remoteVideo");
    const videoContainer = document.getElementById("videoContainer");
    const voiceCallContainer = document.getElementById("voiceCallContainer");
    const callTimer = document.getElementById("callTimer");
    const toggleMuteButton = document.getElementById("toggleMuteButton");
    const toggleMuteButtonVoice = document.getElementById("toggleMuteButtonVoice");
    const toggleVideoButton = document.getElementById("toggleVideoButton");
    const remoteAudio = document.getElementById("remoteAudio");

    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    if (remoteAudio) {
        remoteAudio.srcObject = null;
        remoteAudio.remove();
    }
    if (videoContainer) videoContainer.classList.add("d-none");
    if (voiceCallContainer) voiceCallContainer.classList.add("d-none");
    if (callTimer) callTimer.textContent = "Connecting...";
    if (toggleMuteButton) {
        toggleMuteButton.innerHTML = '<i class="fas fa-microphone"></i>';
        toggleMuteButton.title = "Mute";
    }
    if (toggleMuteButtonVoice) {
        toggleMuteButtonVoice.innerHTML = '<i class="fas fa-microphone"></i>';
        toggleMuteButtonVoice.title = "Mute";
    }
    if (toggleVideoButton) {
        toggleVideoButton.innerHTML = '<i class="fas fa-video"></i>';
        toggleVideoButton.title = "Turn Camera Off";
    }

    clearInterval(callTimerInterval);
    callTimerInterval = null;
    callStartTime = null;

    if (incomingCaller || remoteUser) {
        const target = incomingCaller || remoteUser;
        if (connection.state === signalR.HubConnectionState.Connected) {
            connection.invoke("SendCallEnded", target).catch(err => console.error(err));
        }
        incomingCaller = null;
        remoteUser = null;
    }
    isVideoCall = false;
}

document.getElementById("startCall").addEventListener("click", () => {
    if (currentFriend) {
        startCall(currentFriend, false);
    } else {
        alert("Please select a friend to call.");
    }
});

document.getElementById("startVideoCall").addEventListener("click", () => {
    if (currentFriend) {
        startCall(currentFriend, true);
    } else {
        alert("Please select a friend to call.");
    }
});