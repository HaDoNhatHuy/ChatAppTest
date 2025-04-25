$(document).ready(function () {
    $('.nav-link').on('click', function (e) {
        e.preventDefault();
        const href = $(this).attr('href');
        window.location.href = href;
    });
});