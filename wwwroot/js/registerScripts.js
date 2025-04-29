function togglePassword(inputId) {
    const passwordInput = document.getElementById(inputId);
    const passwordIcon = document.getElementById(inputId + '-icon');

    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        passwordIcon.classList.remove('fa-eye-slash');
        passwordIcon.classList.add('fa-eye');
    } else {
        passwordInput.type = 'password';
        passwordIcon.classList.remove('fa-eye');
        passwordIcon.classList.add('fa-eye-slash');
    }
}

document.addEventListener('DOMContentLoaded', function () {
    // Password validation
    const password = document.getElementById('new1Password');
    const confirmPassword = document.getElementById('new2Password');
    const progressBar = document.getElementById('register-progress');
    const strengthText = document.getElementById('strength-text');
    const strengthSegments = [
        document.getElementById('strength-1'),
        document.getElementById('strength-2'),
        document.getElementById('strength-3'),
        document.getElementById('strength-4')
    ];

    function updateStrengthMeter(score) {
        // Reset all segments
        strengthSegments.forEach(segment => {
            segment.className = 'strength-segment';
        });

        let strengthColor = '';
        let strengthMessage = '';

        // Update segments based on score
        if (score >= 1) {
            strengthSegments[0].classList.add('strength-weak');
            strengthColor = 'var(--danger-color)';
            strengthMessage = 'Too weak';
        }
        if (score >= 2) {
            strengthSegments[1].classList.add('strength-fair');
            strengthColor = 'var(--warning-color)';
            strengthMessage = 'Fair';
        }
        if (score >= 3) {
            strengthSegments[2].classList.add('strength-good');
            strengthColor = 'var(--info-color)';
            strengthMessage = 'Good';
        }
        if (score >= 4) {
            strengthSegments[3].classList.add('strength-strong');
            strengthColor = 'var(--success-color)';
            strengthMessage = 'Strong';
        }

        strengthText.textContent = `Password strength: ${strengthMessage}`;
        strengthText.style.color = strengthColor;

        // Update progress bar
        progressBar.style.width = `${(score * 25)}%`;
        if (score === 1) progressBar.className = 'progress-bar bg-danger';
        else if (score === 2) progressBar.className = 'progress-bar bg-warning';
        else if (score === 3) progressBar.className = 'progress-bar bg-info';
        else if (score === 4) progressBar.className = 'progress-bar bg-success';
        else progressBar.className = 'progress-bar';
    }

    password.addEventListener('keyup', function () {
        const value = this.value;
        let score = 0;

        // Update password requirements
        const letter = document.getElementById('letter');
        const capital = document.getElementById('capital');
        const number = document.getElementById('number');
        const length = document.getElementById('length');
        const special = document.getElementById('special');

        // Check lowercase letters
        if (value.match(/[a-z]/g)) {
            letter.classList.remove('invalid');
            letter.classList.add('valid');
            letter.querySelector('i').className = 'fas fa-check-circle me-2';
            score++;
        } else {
            letter.classList.remove('valid');
            letter.classList.add('invalid');
            letter.querySelector('i').className = 'fas fa-times-circle me-2';
        }

        // Check uppercase letters
        if (value.match(/[A-Z]/g)) {
            capital.classList.remove('invalid');
            capital.classList.add('valid');
            capital.querySelector('i').className = 'fas fa-check-circle me-2';
            score++;
        } else {
            capital.classList.remove('valid');
            capital.classList.add('invalid');
            capital.querySelector('i').className = 'fas fa-times-circle me-2';
        }

        // Check numbers
        if (value.match(/[0-9]/g)) {
            number.classList.remove('invalid');
            number.classList.add('valid');
            number.querySelector('i').className = 'fas fa-check-circle me-2';
            score++;
        } else {
            number.classList.remove('valid');
            number.classList.add('invalid');
            number.querySelector('i').className = 'fas fa-times-circle me-2';
        }

        // Check length
        if (value.length >= 8) {
            length.classList.remove('invalid');
            length.classList.add('valid');
            length.querySelector('i').className = 'fas fa-check-circle me-2';
            score++;
        } else {
            length.classList.remove('valid');
            length.classList.add('invalid');
            length.querySelector('i').className = 'fas fa-times-circle me-2';
        }

        // Check special characters
        if (value.match(/[!@#$%^&*(),.?":{ }|<>]/g)) {
            special.classList.remove('invalid');
            special.classList.add('valid');
            special.querySelector('i').className = 'fas fa-check-circle me-2';
            score++;
        } else {
            special.classList.remove('valid');
            special.classList.add('invalid');
            special.querySelector('i').className = 'fas fa-times-circle me-2';
        }

        // Cap the score at 4 (if we check more than 4 conditions)
        score = Math.min(score, 4);
        updateStrengthMeter(score);

        // Check if passwords match
        checkPasswordsMatch();
    });

    function checkPasswordsMatch() {
        const match = document.getElementById('match');
        if (confirmPassword.value === password.value && password.value !== '') {
            match.classList.remove('invalid');
            match.classList.add('valid');
            match.querySelector('i').className = 'fas fa-check-circle me-2';
        } else {
            match.classList.remove('valid');
            match.classList.add('invalid');
            match.querySelector('i').className = 'fas fa-times-circle me-2';
        }
    }

    confirmPassword.addEventListener('keyup', checkPasswordsMatch);
}