using HermesChatApp.Data;
using HermesChatApp.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;

namespace HermesChatApp.Controllers
{
    public class UserController : Controller
    {
        private readonly AppDbContext _context;

        public UserController(AppDbContext context)
        {
            _context = context;
        }

        public IActionResult Login()
        {
            return View();
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Login(string username, string password)
        {
            if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password))
            {
                ViewBag.Error = "Vui lòng nhập tên người dùng và mật khẩu.";
                return View();
            }

            var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
            if (user == null || !VerifyPassword(password, user.PasswordHash))
            {
                ViewBag.Error = "Tên người dùng hoặc mật khẩu không đúng.";
                return View();
            }

            HttpContext.Session.SetString("Username", username);
            return RedirectToAction("Index", "Chat");
        }

        public IActionResult Register()
        {
            return View();
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Register(User user, string ConfirmPassword)
        {
            if (_context.Users.Any(u => u.Username == user.Username))
            {
                ViewBag.Error = "Tên người dùng đã tồn tại.";
                return View();
            }

            if (string.IsNullOrEmpty(user.Username) || string.IsNullOrEmpty(user.Email) || string.IsNullOrEmpty(user.PasswordHash))
            {
                ViewBag.Error = "Vui lòng nhập đầy đủ thông tin.";
                return View();
            }

            if (user.PasswordHash != ConfirmPassword)
            {
                ViewBag.Error = "Mật khẩu không khớp.";
                return View();
            }

            user.PasswordHash = HashPassword(user.PasswordHash);
            //user.LastOnline = DateTime.UtcNow;
            user.LastOnline = DateTime.Now;
            _context.Users.Add(user);
            await _context.SaveChangesAsync();

            TempData["SuccessfulRegister"] = "Đăng ký thành công! Vui lòng đăng nhập.";
            return RedirectToAction("Login");
        }

        public IActionResult Logout()
        {
            HttpContext.Session.Clear();
            return RedirectToAction("Login");
        }

        [HttpGet]
        public async Task<IActionResult> SearchUsers(string query)
        {
            if (string.IsNullOrEmpty(query))
            {
                return Json(new { users = new List<string>() });
            }

            var currentUser = HttpContext.Session.GetString("Username");
            var users = await _context.Users
                .Where(u => u.Username.Contains(query) && u.Username != currentUser)
                .Select(u => u.Username)
                .ToListAsync();

            return Json(new { users });
        }

        private string HashPassword(string password)
        {
            using var sha256 = SHA256.Create();
            var bytes = Encoding.UTF8.GetBytes(password);
            var hash = sha256.ComputeHash(bytes);
            return Convert.ToBase64String(hash);
        }

        private bool VerifyPassword(string password, string hashedPassword)
        {
            var hash = HashPassword(password);
            return hash == hashedPassword;
        }
    }
}