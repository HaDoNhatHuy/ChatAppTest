$(document).ready(function () {
    $('#new1Password').keyup(function () {
        var pswd = $(this).val();
        $('#letter').toggleClass('valid', pswd.match(/[a-z]/)).toggleClass('invalid', !pswd.match(/[a-z]/));
        $('#capital').toggleClass('valid', pswd.match(/[A-Z]/)).toggleClass('invalid', !pswd.match(/[A-Z]/));
        $('#number').toggleClass('valid', pswd.match(/\d/)).toggleClass('invalid', !pswd.match(/\d/));
        $('#length').toggleClass('valid', pswd.length >= 8).toggleClass('invalid', pswd.length < 8);
        $('#special').toggleClass('valid', pswd.match(/[^a-zA-Z\d]/)).toggleClass('invalid', !pswd.match(/[^a-zA-Z\d]/));
    });

    $('#new2Password').keyup(function () {
        var pswd1 = $('#new1Password').val();
        var pswd2 = $(this).val();
        $('#match').toggleClass('valid', pswd1 === pswd2 && pswd2 !== '').toggleClass('invalid', pswd1 !== pswd2 || pswd2 === '');
    });
});