< !--JavaScript -->

    // Load user info on page load
    document.addEventListener("DOMContentLoaded", async () => {
        try {
            // Fetch user info
            const response = await fetch("/User/GetUserInfo");
            const data = await response.json();
            if (response.ok) {
                document.getElementById("emailInput").value = data.email || "";
                document.getElementById("fullNameInput").value = data.fullName || "";
                document.getElementById("bioInput").value = data.bio || "";
                document.getElementById("avatarPreview").src = data.avatarUrl;

                // Set theme toggle based on current theme
                const isDarkMode = document.body.classList.contains('dark-mode');
                document.getElementById("darkModeToggle").checked = isDarkMode;
            } else {
                console.error("Error fetching user info:", data.message);
            }
        } catch (err) {
            console.error("Error fetching user info:", err);
        }

        // Setup password strength meter
        const newPasswordInput = document.getElementById('newPassword');
        const passwordStrength = document.getElementById('passwordStrength');

        if (newPasswordInput && passwordStrength) {
            newPasswordInput.addEventListener('input', function () {
                const password = this.value;
                let strength = 0;

                // Length check
                if (password.length >= 8) strength += 25;

                // Uppercase check
                if (/[A-Z]/.test(password)) strength += 25;

                // Lowercase check
                if (/[a-z]/.test(password)) strength += 25;

                // Number/symbol check
                if (/[0-9!@#$%^&*]/.test(password)) strength += 25;

                // Update strength bar
                passwordStrength.style.width = strength + '%';

                // Update color based on strength
                if (strength <= 25) {
                    passwordStrength.style.backgroundColor = '#dc3545'; // Weak
                } else if (strength <= 50) {
                    passwordStrength.style.backgroundColor = '#ffc107'; // Medium
                } else if (strength <= 75) {
                    passwordStrength.style.backgroundColor = '#6c757d'; // Strong
                } else {
                    passwordStrength.style.backgroundColor = '#198754'; // Very strong
                }
            });
        }

        // Theme toggle functionality
        const darkModeToggle = document.getElementById('darkModeToggle');
        if (darkModeToggle) {
            darkModeToggle.addEventListener('change', function () {
                if (this.checked) {
                    document.body.classList.add('dark-mode');
                    localStorage.setItem('theme', 'dark');
                } else {
                    document.body.classList.remove('dark-mode');
                    localStorage.setItem('theme', 'light');
                }
            });
        }
    });

// Preview avatar before uploading
function previewAvatar(event) {
    const input = event.target;
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function (e) {
            document.getElementById("avatarPreview").src = e.target.result;
        };
        reader.readAsDataURL(input.files[0]);
    }
}