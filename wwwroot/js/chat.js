"use strict";

const connection = new signalR.HubConnectionBuilder()
    .withUrl(`/chatHub?username=${encodeURIComponent(currentUser)}`)
    .build();

let isConnected = false;
let peer = null;
let localStream = null;
let isCalling = false;

connection.on("ReceiveMessage", function (user, message) {
    const li = document.createElement("li");
    li.className = `message ${user === currentUser ? "sent" : ""}`;
    const time = new Date().toLocaleTimeString();
    li.innerHTML = `<strong>${user}</strong>: ${message} <small class="text-muted">${time}</small>`;
    document.getElementById("messagesList").appendChild(li);
    document.querySelector(".messages").scrollTop = document.querySelector(".messages").scrollHeight;
});

connection.on("ReceiveUsersOnline", function (users) {
    const ul = document.getElementById("userOnlineList");
    ul.innerHTML = "";
    users.forEach(user => {
        const li = document.createElement("li");
        li.textContent = user;
        li.className = "p-2 rounded hover-bg-light cursor-pointer";
        li.onclick = () => initiateVideoCall(user);
        ul.appendChild(li);
    });
});

connection.start().then(function () {
    isConnected = true;
    console.log("SignalR connected successfully for user: " + currentUser);
    connection.invoke("GetUsersOnline").catch(function (err) {
        return console.error("Error invoking GetUsersOnline:", err.toString());
    });
}).catch(function (err) {
    isConnected = false;
    console.error("SignalR connection failed:", err.toString());
    alert("Failed to connect to the chat server. Please refresh the page and try again.");
});

document.getElementById("sendButton").addEventListener("click", function (event) {
    if (!isConnected) {
        alert("Please wait for the connection to be established.");
        event.preventDefault();
        return;
    }

    const user = currentUser;
    const message = document.getElementById("messageInput").value;
    const room = document.getElementById("roomName").value || "General";
    if (message.trim()) {
        connection.invoke("SendMessage", user, message, room).catch(function (err) {
            return console.error("Error sending message:", err.toString());
        });
        document.getElementById("messageInput").value = "";
    }
    event.preventDefault();
});

document.getElementById("joinRoomButton").addEventListener("click", function (event) {
    if (!isConnected) {
        alert("Please wait for the connection to be established.");
        event.preventDefault();
        return;
    }

    const room = document.getElementById("roomName").value || "General";
    document.getElementById("chat-intro").textContent = `Room: ${room}`;
    connection.invoke("JoinRoom", room).catch(function (err) {
        document.getElementById("groupError").textContent = "Error joining room.";
        return console.error(err.toString());
    });
    event.preventDefault();
});

function initiateVideoCall(targetUser) {
    if (!isConnected) {
        alert("Please wait for the connection to be established.");
        return;
    }

    if (targetUser === currentUser) {
        alert("You cannot call yourself.");
        return;
    }

    if (isCalling) {
        alert("You are already in a call. Please end the current call before starting a new one.");
        return;
    }

    isCalling = true;

    const existingCallingMessage = document.getElementById("callingMessage");
    if (existingCallingMessage) {
        existingCallingMessage.remove();
    }

    const callingMessage = document.createElement("div");
    callingMessage.id = "callingMessage";
    callingMessage.className = "text-center p-3";
    callingMessage.textContent = `Calling ${targetUser}...`;
    document.getElementById("videoContainer").appendChild(callingMessage);

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            console.log("Local stream obtained successfully:", stream);
            localStream = stream;
            const localVideo = document.getElementById("localVideo");
            localVideo.srcObject = stream;
            localVideo.onloadedmetadata = () => {
                console.log("Local video metadata loaded, playing video...");
                localVideo.play().catch(err => console.error("Error playing local video:", err));
            };
            document.getElementById("videoContainer").classList.remove("d-none");

            peer = new SimplePeer({
                initiator: true,
                trickle: false,
                stream: stream,
                config: {
                    iceServers: [
                        { urls: "stun:stun.l.google.com:19302" },
                        { urls: "stun:stun1.l.google.com:19302" },
                        { urls: "stun:stun2.l.google.com:19302" },
                        { urls: "stun:stun3.l.google.com:19302" },
                        { urls: "stun:stun4.l.google.com:19302" },
                        {
                            urls: "turn:turn.anyfirewall.com:443?transport=tcp",
                            username: "webrtc",
                            credential: "webrtc"
                        }
                    ]
                }
            });

            peer.on("signal", data => {
                console.log(`Sending signal to ${targetUser}:`, data);
                connection.invoke("SendSignal", targetUser, JSON.stringify(data))
                    .catch(err => {
                        console.error("Error sending signal:", err.toString());
                        alert(`Failed to initiate call to ${targetUser}. They may not be online.`);
                        callingMessage.remove();
                        endCall();
                    });
            });

            peer.on("stream", stream => {
                console.log("Received remote stream:", stream);
                const remoteVideo = document.getElementById("remoteVideo");
                remoteVideo.srcObject = stream;
                remoteVideo.onloadedmetadata = () => {
                    console.log("Remote video metadata loaded, playing video...");
                    remoteVideo.play().catch(err => console.error("Error playing remote video:", err));
                };
                callingMessage.remove();
            });

            peer.on("connect", () => {
                console.log("WebRTC connection established successfully");
            });

            peer.on("error", err => {
                console.error("Peer error:", err);
                alert("An error occurred during the call: " + err.message);
                callingMessage.remove();
                endCall();
            });

            peer.on("close", () => {
                console.log("WebRTC connection closed");
                endCall();
            });

            const stopButton = document.createElement("button");
            stopButton.id = "stopVideoCall";
            stopButton.className = "btn btn-danger mt-2";
            stopButton.textContent = "Stop Call";
            document.getElementById("videoContainer").appendChild(stopButton);

            stopButton.addEventListener("click", function () {
                endCall();
                callingMessage.remove();
                stopButton.remove();
            });
        })
        .catch(err => {
            console.error("Error accessing media devices:", err);
            alert("Could not access webcam or microphone. Please check your device and permissions.");
            callingMessage.remove();
            isCalling = false;
        });
}

connection.on("ReceiveSignal", function (sender, signalData) {
    console.log(`Received signal from ${sender}:`, signalData);

    const videoContainer = document.getElementById("videoContainer");
    if (!videoContainer) {
        console.error("videoContainer not found in the DOM");
        return;
    }
    videoContainer.classList.remove("d-none");

    const existingCallPrompt = document.getElementById("callPrompt");
    if (existingCallPrompt) {
        existingCallPrompt.remove();
    }

    if (isCalling) {
        endCall();
    }

    const callPrompt = document.createElement("div");
    callPrompt.id = "callPrompt";
    callPrompt.className = "text-center p-3 bg-light border rounded";
    callPrompt.innerHTML = `
        <p>Incoming call from ${sender}</p>
        <button id="acceptCall" class="btn btn-success me-2">Accept</button>
        <button id="rejectCall" class="btn btn-danger">Reject</button>
    `;
    videoContainer.appendChild(callPrompt);

    document.getElementById("acceptCall").addEventListener("click", function () {
        if (isCalling) {
            alert("You are already in a call. Please end the current call before accepting a new one.");
            callPrompt.remove();
            return;
        }

        isCalling = true;
        callPrompt.remove();

        navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            .then(stream => {
                console.log("Local stream obtained successfully for receiver:", stream);
                localStream = stream;
                const localVideo = document.getElementById("localVideo");
                localVideo.srcObject = stream;
                localVideo.onloadedmetadata = () => {
                    console.log("Local video metadata loaded for receiver, playing video...");
                    localVideo.play().catch(err => console.error("Error playing local video:", err));
                };
                videoContainer.classList.remove("d-none");

                peer = new SimplePeer({
                    initiator: false,
                    trickle: false,
                    stream: stream,
                    config: {
                        iceServers: [
                            { urls: "stun:stun.l.google.com:19302" },
                            { urls: "stun:stun1.l.google.com:19302" },
                            { urls: "stun:stun2.l.google.com:19302" },
                            { urls: "stun:stun3.l.google.com:19302" },
                            { urls: "stun:stun4.l.google.com:19302" },
                            {
                                urls: "turn:turn.anyfirewall.com:443?transport=tcp",
                                username: "webrtc",
                                credential: "webrtc"
                            }
                        ]
                    }
                });

                peer.on("signal", data => {
                    console.log(`Sending signal back to ${sender}:`, data);
                    connection.invoke("SendSignal", sender, JSON.stringify(data))
                        .catch(err => console.error("Error sending signal:", err.toString()));
                });

                peer.on("stream", stream => {
                    console.log("Received remote stream for receiver:", stream);
                    const remoteVideo = document.getElementById("remoteVideo");
                    remoteVideo.srcObject = stream;
                    remoteVideo.onloadedmetadata = () => {
                        console.log("Remote video metadata loaded for receiver, playing video...");
                        remoteVideo.play().catch(err => console.error("Error playing remote video:", err));
                    };
                });

                peer.on("connect", () => {
                    console.log("WebRTC connection established successfully for receiver");
                });

                peer.on("error", err => {
                    console.error("Peer error for receiver:", err);
                    alert("An error occurred during the call: " + err.message);
                    endCall();
                });

                peer.on("close", () => {
                    console.log("WebRTC connection closed for receiver");
                    endCall();
                });

                const stopButton = document.createElement("button");
                stopButton.id = "stopVideoCall";
                stopButton.className = "btn btn-danger mt-2";
                stopButton.textContent = "Stop Call";
                videoContainer.appendChild(stopButton);

                stopButton.addEventListener("click", function () {
                    endCall();
                    stopButton.remove();
                });

                try {
                    console.log("Processing signal data:", signalData);
                    peer.signal(JSON.parse(signalData));
                } catch (err) {
                    console.error("Error processing signal:", err);
                    alert("Failed to process call signal: " + err.message);
                    endCall();
                }
            })
            .catch(err => {
                console.error("Error accessing media devices for receiver:", err);
                alert("Could not access webcam or microphone. Please check your device and permissions.");
                isCalling = false;
            });
    });

    document.getElementById("rejectCall").addEventListener("click", function () {
        callPrompt.remove();
        videoContainer.classList.add("d-none");
    });
});

document.getElementById("startVideoCall").addEventListener("click", function () {
    const targetUser = prompt("Enter username to call:");
    if (targetUser) {
        initiateVideoCall(targetUser);
    }
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
    const callingMessage = document.getElementById("callingMessage");
    if (callingMessage) {
        callingMessage.remove();
    }
    const stopButton = document.getElementById("stopVideoCall");
    if (stopButton) {
        stopButton.remove();
    }
    isCalling = false;
}