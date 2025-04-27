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

// Đảm bảo DOM được tải hoàn toàn trước khi chạy mã
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
        if (messagesList.scrollTop + messagesList.clientHeight < messagesList.scrollHeight - 50) {
            scrollToBottomBtn.classList.add("active");
        } else {
            scrollToBottomBtn.classList.remove("active");
        }
    });

    document.getElementById("scrollToBottomBtn").addEventListener("click", () => {
        messagesList.scrollTop = messagesList.scrollHeight;
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

connection.on("ReceiveMessage", (sender, message, receiver, messageType = "Text", fileUrl = null, isPinned = false, messageId, timestamp) => {
    console.log(`Received message: Sender=${sender}, Receiver=${receiver}, Content=${message}, Type=${messageType}, ID=${messageId}, Timestamp=${timestamp}`);
    if ((sender === currentFriend && receiver === currentUser) || (sender === currentUser && receiver === currentFriend)) {
        const messagesList = document.getElementById("messagesList");
        if (!messagesList) {
            console.error("Messages list element not found!");
            return;
        }

        const lastMessage = messagesList.lastElementChild;
        const messageDate = new Date(timestamp);
        const messageDateString = messageDate.toLocaleDateString();

        let lastMessageDateString = null;
        if (lastMessage && lastMessage.dataset.timestamp) {
            const lastMessageDate = new Date(lastMessage.dataset.timestamp);
            lastMessageDateString = lastMessageDate.toLocaleDateString();
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
        let content = message;
        if (messageType === "Image") {
            content = `<img src="${fileUrl}" alt="Image" />`;
        } else if (messageType === "File") {
            content = `<a href="${fileUrl}" class="file-link" target="_blank">Download File</a>`;
        }
        li.innerHTML = `
            <img src="/images/avatars/${sender}.jpg" class="avatar" onerror="this.src='/images/avatars/default.jpg'" />
            <div class="content">
                <span>${content}</span>
                <small>${messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                <button class="pin-button btn btn-sm btn-outline-secondary">${isPinned ? "Unpin" : "Pin"}</button>
            </div>
        `;
        messagesList.appendChild(li);

        if (!oldestMessageId || messageId < oldestMessageId) {
            oldestMessageId = messageId;
        }

        if (sender === currentUser) {
            messagesList.scrollTop = messagesList.scrollHeight;
        } else {
            const isNearBottom = messagesList.scrollTop + messagesList.clientHeight >= messagesList.scrollHeight - 50;
            if (isNearBottom) {
                messagesList.scrollTop = messagesList.scrollHeight;
            }
        }

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
        pendingMessages[sender].push({ sender, message, receiver, messageType, fileUrl, isPinned, messageId, timestamp });
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
        const messageDateString = messageDate.toLocaleDateString();

        const firstMessage = messagesList.firstElementChild;
        let firstMessageDateString = null;
        if (firstMessage && firstMessage.dataset.timestamp) {
            const firstMessageDate = new Date(firstMessage.dataset.timestamp);
            firstMessageDateString = firstMessageDate.toLocaleDateString();
        }

        if (!firstMessageDateString || messageDateString !== firstMessageDateString) {
            const divider = document.createElement("div");
            divider.className = `date-divider date-${messageDateString}`;
            divider.innerHTML = `<span>${messageDateString}</span>`;
            messagesList.insertBefore(divider, messagesList.firstChild);
        }

        const li = document.createElement("li");
        li.className = `message ${msg.SenderUsername === currentUser ? "sent" : "received"} ${msg.IsPinned ? "pinned" : ""}`;
        li.dataset.messageId = msg.Id;
        li.dataset.timestamp = msg.Timestamp;
        let content = msg.Content;
        if (msg.MessageType === "Image") {
            content = `<img src="${msg.FileUrl}" alt="Image" />`;
        } else if (msg.MessageType === "File") {
            content = `<a href="${msg.FileUrl}" class="file-link" target="_blank">Download File</a>`;
        }
        li.innerHTML = `
            <img src="/images/avatars/${msg.SenderUsername}.jpg" class="avatar" onerror="this.src='/images/avatars/default.jpg'" />
            <div class="content">
                <span>${content}</span>
                <small>${messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                <button class="pin-button btn btn-sm btn-outline-secondary">${msg.IsPinned ? "Unpin" : "Pin"}</button>
            </div>
        `;
        messagesList.insertBefore(li, messagesList.firstChild);

        if (!oldestMessageId || msg.Id < oldestMessageId) {
            oldestMessageId = msg.Id;
        }

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

connection.on("ReceiveNewMessageNotification", (sender) => {
    console.log(`New message notification from ${sender}`);
    if (sender !== currentFriend) {
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
            });
        };
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
    if (sender === currentFriend) {
        const typingIndicator = document.getElementById("typingIndicator");
        if (typingIndicator) {
            typingIndicator.style.display = "block";
        }
    }
});

connection.on("ReceiveStopTyping", (sender) => {
    if (sender === currentFriend) {
        const typingIndicator = document.getElementById("typingIndicator");
        if (typingIndicator) {
            typingIndicator.style.display = "none";
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
            break;
        }
    }
});

connection.on("ReceiveFriends", (friends, friendStatuses) => {
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
            document.getElementById("messagesList").innerHTML = "";
            oldestMessageId = null;
            const loadingSpinner = document.getElementById("loadingSpinner");
            if (loadingSpinner) {
                loadingSpinner.classList.add("active");
            }

            const pendingMessages = JSON.parse(localStorage.getItem("pendingMessages") || "{}");
            if (pendingMessages[friend]) {
                pendingMessages[friend].forEach(msg => {
                    connection.invoke("ReceiveMessage", msg.sender, msg.message, msg.receiver, msg.messageType, msg.fileUrl, msg.isPinned, msg.messageId, msg.timestamp);
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
                messagesList.scrollTop = messagesList.scrollHeight;
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
    const diff = Math.round((now - lastOnline) / 60000);
    if (diff < 1) {
        element.textContent = "Offline just now";
    } else if (diff < 60) {
        element.textContent = `Offline ${diff} mins ago`;
    } else {
        const hours = Math.round(diff / 60);
        element.textContent = `Offline ${hours} hours ago`;
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
            div.innerHTML = `
                <span>${user}</span>
                <button class="btn btn-primary btn-sm">Add Friend</button>
            `;
            div.querySelector("button").onclick = () => {
                console.log(`Sending friend request from ${currentUser} to ${user}`);
                connection.invoke("SendFriendRequest", currentUser, user).catch(err => {
                    console.error("Error sending friend request:", err);
                });
            };
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
        connection.invoke("SendTyping", currentUser, currentFriend);
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            connection.invoke("StopTyping", currentUser, currentFriend);
        }, 2000);
    }
});

document.getElementById("emojiButton").addEventListener("click", () => {
    const picker = document.getElementById("emojiPicker");
    picker.style.display = picker.style.display === "block" ? "none" : "block";
});

document.querySelectorAll(".emoji").forEach(emoji => {
    emoji.addEventListener("click", () => {
        const messageInput = document.getElementById("messageInput");
        messageInput.value += emoji.dataset.emoji;
        document.getElementById("emojiPicker").style.display = "none";
    });
});

document.getElementById("fileButton").addEventListener("click", () => {
    document.getElementById("fileInput").click();
});

document.getElementById("fileInput").addEventListener("change", async () => {
    const file = document.getElementById("fileInput").files[0];
    if (file && currentFriend) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/upload", {
            method: "POST",
            body: formData
        });
        const data = await response.json();
        if (data.fileUrl) {
            const messageType = file.type.startsWith("image/") ? "Image" : "File";
            connection.invoke("SendFileMessage", currentUser, currentFriend, data.fileUrl, messageType);
        }
    }
});

async function startVideoCall(targetUser) {
    // Kiểm tra nếu đã có cuộc gọi đang diễn ra
    if (peer || localStream) {
        alert("A call is already in progress. Please end the current call first.");
        return;
    }

    if (!currentFriend) {
        alert("Please select a friend to call.");
        return;
    }

    // Kiểm tra trạng thái kết nối SignalR
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

    // Kiểm tra trạng thái kết nối SignalR
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