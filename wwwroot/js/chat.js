const connection = new signalR.HubConnectionBuilder()
    .withUrl("/chatHub?username=" + encodeURIComponent(currentUser))
    .configureLogging(signalR.LogLevel.Information)
    .build();

let currentRoom = "";
let peer = null;
let localStream = null;

async function startConnection() {
    try {
        await connection.start();
        console.log("SignalR Connected.");
        await connection.invoke("GetUsersOnline");
    } catch (err) {
        console.error(err);
        setTimeout(startConnection, 5000);
    }
}

connection.onclose(async () => {
    await startConnection();
});

connection.on("ReceiveMessage", (user, message) => {
    const li = document.createElement("li");
    li.className = `message ${user === currentUser ? "sent" : ""}`;
    li.innerHTML = `<strong>${user}</strong>: ${message}`;
    document.getElementById("messagesList").appendChild(li);
    document.getElementById("messagesList").scrollTop = document.getElementById("messagesList").scrollHeight;
});

connection.on("ReceiveUsersOnline", (users) => {
    const userList = document.getElementById("userOnlineList");
    userList.innerHTML = "";
    users.forEach(user => {
        const li = document.createElement("li");
        li.textContent = user;
        li.className = "p-2 hover-bg-light cursor-pointer";
        li.onclick = () => startVideoCall(user);
        userList.appendChild(li);
    });
});

document.getElementById("joinRoomButton").addEventListener("click", async () => {
    const roomName = document.getElementById("roomName").value.trim();
    if (roomName) {
        currentRoom = roomName;
        document.getElementById("chat-intro").textContent = `Chatting in ${roomName}`;
        await connection.invoke("JoinRoom", roomName).catch(err => console.error(err));
        document.getElementById("messagesList").innerHTML = "";
    } else {
        document.getElementById("groupError").textContent = "Please enter a room name.";
    }
});

document.getElementById("sendButton").addEventListener("click", () => {
    const message = document.getElementById("messageInput").value.trim();
    if (message && currentRoom) {
        connection.invoke("SendMessage", currentUser, message, currentRoom).catch(err => console.error(err));
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
    if (!currentRoom) {
        alert("Please join a room first.");
        return;
    }

    try {
        // Get local video stream
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById("localVideo").srcObject = localStream;
        document.getElementById("videoContainer").classList.remove("d-none");

        // Initialize SimplePeer
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
        try {
            // Get local video stream for the receiver
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            document.getElementById("localVideo").srcObject = localStream;
            document.getElementById("videoContainer").classList.remove("d-none");

            // Initialize SimplePeer as receiver
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

            // Signal the received data
            peer.signal(JSON.parse(signalData));
        } catch (err) {
            console.error("Error accessing media devices:", err);
            alert("Could not access camera or microphone.");
        }
    } else {
        // Handle incoming signal for existing peer
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
}

document.getElementById("startVideoCall").addEventListener("click", () => {
    const targetUser = prompt("Enter username to call:");
    if (targetUser && targetUser !== currentUser) {
        startVideoCall(targetUser);
    } else {
        alert("Please enter a valid username.");
    }
});

startConnection();