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

// Đảm bảo DOM được tải hoàn toàn trước khi chạy mã
document.addEventListener("DOMContentLoaded", async () => {
    console.log("DOM loaded, initializing chat...");

    // Xóa currentFriend khỏi localStorage khi tải trang để không tự động mở cuộc trò chuyện
    localStorage.removeItem("currentFriend");
    console.log("Cleared currentFriend from localStorage on page load");

    // Đợi kết nối SignalR trước khi tải danh sách bạn bè
    await startConnection();
});

async function startConnection() {
    try {
        if (connection.state !== signalR.HubConnectionState.Disconnected) {
            console.log(`SignalR connection is in ${connection.state} state. Stopping current connection...`);
            await connection.stop();
        }
        console.log("Attempting to start SignalR connection...");
        await connection.start();
        console.log("SignalR Connected.");
        await connection.invoke("GetFriends", currentUser);
        await connection.invoke("GetFriendRequests", currentUser);
        await connection.invoke("GetUnreadCounts", currentUser);
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
    console.log(`Current user: ${currentUser}, Current friend: ${currentFriend}`);

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
        messagesList.scrollTop = messagesList.scrollHeight;

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
        // Lưu tin nhắn vào localStorage để hiển thị sau khi chọn bạn bè
        const pendingMessages = JSON.parse(localStorage.getItem("pendingMessages") || "{}");
        if (!pendingMessages[sender]) {
            pendingMessages[sender] = [];
        }
        pendingMessages[sender].push({ sender, message, receiver, messageType, fileUrl, isPinned, messageId, timestamp });
        localStorage.setItem("pendingMessages", JSON.stringify(pendingMessages));
    }
    connection.invoke("GetUnreadCounts", currentUser);
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
                loadingSpinner.style.display = "block";
            }
            connection.invoke("LoadMessages", currentUser, sender).catch(err => {
                console.error("Error loading messages:", err);
            }).finally(() => {
                if (loadingSpinner) {
                    loadingSpinner.style.display = "none";
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
            dot.className = `status-dot ${isOnline ? "online" : "offline"}`;
            const offlineSpan = item.querySelector(".last-offline");
            if (!isOnline && offlineSpan) {
                updateLastOfflineTime(offlineSpan, new Date());
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
            const loadingSpinner = document.getElementById("loadingSpinner");
            if (loadingSpinner) {
                loadingSpinner.style.display = "block";
            }

            // Hiển thị tin nhắn pending từ localStorage
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
                    loadingSpinner.style.display = "none";
                }
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
    document.getElementById("friendRequestModal").classList.remove("d-none");

    document.getElementById("acceptFriendRequestButton").onclick = () => {
        document.getElementById("friendRequestModal").classList.add("d-none");
        connection.invoke("AcceptFriendRequest", currentUser, sender).catch(err => console.error(err));
    };

    document.getElementById("declineFriendRequestButton").onclick = () => {
        document.getElementById("friendRequestModal").classList.add("d-none");
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
    const friendItems = document.getElementById("friendList").getElementsByTagName("li");
    for (let item of friendItems) {
        if (item.dataset.username === friend) {
            const offlineSpan = item.querySelector(".last-offline");
            if (lastOnline) {
                const lastOnlineDate = new Date(lastOnline);
                updateLastOfflineTime(offlineSpan, lastOnlineDate);
            }
            break;
        }
    }
});

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

function updateLastOfflineTime(element, lastOnline) {
    const now = new Date();
    const diff = Math.round((now - lastOnline) / 60000);
    element.textContent = diff < 60 ? `Offline ${diff} mins ago` : `Offline ${Math.round(diff / 60)} hours ago`;
}

async function startVideoCall(targetUser) {
    if (!currentFriend) {
        alert("Please select a friend to call.");
        return;
    }

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById("localVideo").srcObject = localStream;
        document.getElementById("localUserLabel").textContent = currentUser;
        document.getElementById("remoteUserLabel").textContent = targetUser;
        document.getElementById("videoContainer").classList.remove("d-none");

        remoteUser = targetUser;

        peer = new SimplePeer({
            initiator: true,
            trickle: false,
            stream: localStream
        });

        peer.on("signal", data => {
            console.log("Sending signal to " + targetUser);
            connection.invoke("SendSignal", targetUser, JSON.stringify(data)).catch(err => console.error(err));
        });

        peer.on("stream", stream => {
            console.log("Received remote stream");
            document.getElementById("remoteVideo").srcObject = stream;
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
    }
}

connection.on("ReceiveSignal", async (sender, signalData) => {
    console.log("Received signal from " + sender);

    if (!peer) {
        incomingCaller = sender;
        document.getElementById("callerName").textContent = sender;
        document.getElementById("callModal").classList.remove("d-none");

        document.getElementById("acceptCallButton").onclick = async () => {
            document.getElementById("callModal").classList.add("d-none");
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                document.getElementById("localVideo").srcObject = localStream;
                document.getElementById("localUserLabel").textContent = currentUser;
                document.getElementById("remoteUserLabel").textContent = sender;
                document.getElementById("videoContainer").classList.remove("d-none");

                remoteUser = sender;

                peer = new SimplePeer({
                    initiator: false,
                    trickle: false,
                    stream: localStream
                });

                peer.on("signal", data => {
                    console.log("Sending response signal to " + sender);
                    connection.invoke("SendSignal", sender, JSON.stringify(data)).catch(err => console.error(err));
                });

                peer.on("stream", stream => {
                    console.log("Received remote stream");
                    document.getElementById("remoteVideo").srcObject = stream;
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
            document.getElementById("callModal").classList.add("d-none");
            connection.invoke("SendCallEnded", sender).catch(err => console.error(err));
            incomingCaller = null;
        };
    } else {
        peer.signal(JSON.parse(signalData));
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
    document.getElementById("localVideo").srcObject = null;
    document.getElementById("remoteVideo").srcObject = null;
    document.getElementById("videoContainer").classList.add("d-none");
    if (incomingCaller || remoteUser) {
        const target = incomingCaller || remoteUser;
        connection.invoke("SendCallEnded", target).catch(err => console.error(err));
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