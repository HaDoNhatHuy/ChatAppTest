const connection = new signalR.HubConnectionBuilder()
    .withUrl("/chatHub?username=" + encodeURIComponent(currentUser))
    .configureLogging(signalR.LogLevel.Information)
    .build();

let currentFriend = null;
let peer = null;
let localStream = null;
let incomingCaller = null;
let remoteUser = null;

async function startConnection() {
    if (connection.state === signalR.HubConnectionState.Disconnected) {
        try {
            await connection.start();
            console.log("SignalR Connected.");
            await connection.invoke("GetFriends", currentUser);
            await connection.invoke("GetFriendRequests", currentUser);
        } catch (err) {
            console.error(err);
            setTimeout(startConnection, 5000);
        }
    } else {
        console.log(`SignalR connection is in ${connection.state} state. Skipping start.`);
    }
}

connection.onclose(async () => {
    console.log("SignalR connection closed. Attempting to reconnect...");
    await startConnection();
});

connection.on("ReceiveMessage", (sender, message, receiver) => {
    if ((sender === currentFriend && receiver === currentUser) || (sender === currentUser && receiver === currentFriend)) {
        const li = document.createElement("li");
        li.className = `message ${sender === currentUser ? "sent" : "received"}`;
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        li.innerHTML = `
            <img src="/images/avatars/${sender}.jpg" class="avatar" onerror="this.src='/images/avatars/default.jpg'" />
            <div class="content">
                <span>${message}</span>
                <small>${timestamp}</small>
            </div>
        `;
        document.getElementById("messagesList").appendChild(li);
        document.getElementById("messagesList").scrollTop = document.getElementById("messagesList").scrollHeight;
    }
});

connection.on("ReceiveUserStatus", (username, isOnline) => {
    const friendItems = document.getElementById("friendList").getElementsByTagName("li");
    for (let item of friendItems) {
        if (item.dataset.username === username) {
            const dot = item.querySelector(".status-dot");
            dot.className = `status-dot ${isOnline ? "online" : "offline"}`;
            break;
        }
    }
});

connection.on("ReceiveFriends", (friends, friendStatuses) => {
    const friendList = document.getElementById("friendList");
    friendList.innerHTML = "";
    friends.forEach(friend => {
        const li = document.createElement("li");
        li.className = "p-2 cursor-pointer";
        li.dataset.username = friend;
        li.innerHTML = `
            ${friend}
            <span class="status-dot ${friendStatuses[friend] ? "online" : "offline"}"></span>
        `;
        li.onclick = () => {
            currentFriend = friend;
            document.getElementById("chat-intro").textContent = `Chatting with ${friend}`;
            document.getElementById("messagesList").innerHTML = "";
            connection.invoke("LoadMessages", currentUser, friend).catch(err => console.error(err));
        };
        friendList.appendChild(li);
    });
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
    alert(message);
});

connection.on("ReceiveSuccess", (message) => {
    alert(message);
});

document.getElementById("searchUser").addEventListener("input", async () => {
    const query = document.getElementById("searchUser").value.trim();
    if (query) {
        const response = await fetch(`/User/SearchUsers?query=${encodeURIComponent(query)}`);
        const data = await response.json();
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
                connection.invoke("SendFriendRequest", currentUser, user).catch(err => console.error(err));
            };
            searchResults.appendChild(div);
        });
    } else {
        document.getElementById("searchResults").innerHTML = "";
    }
});

document.getElement AElement("sendButton").addEventListener("click", () => {
    const message = document.getElementById("messageInput").value.trim();
    if (message && currentFriend) {
        connection.invoke("SendMessage", currentUser, currentFriend, message).catch(err => console.error(err));
        document.getElementById("messageInput").value = "";
    }
});

document.getElementById("messageInput").addEventListener("keypress", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        document.getElementById("sendButton").click();
    }
});

// WebRTC Video Call Logic
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
            endCall();
        });

        peer.on("close", () => {
            console.log("Peer connection closed");
            endCall();
        });

    } catch (err) {
        console.error("Error accessing media devices:", err);
        alert("Could not access camera or microphone.");
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
                    endCall();
                });

                peer.on("close", () => {
                    console.log("Peer connection closed");
                    endCall();
                });

                peer.signal(JSON.parse(signalData));
            } catch (err) {
                console.error("Error accessing media devices:", err);
                alert("Could not access camera or microphone.");
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

startConnection();