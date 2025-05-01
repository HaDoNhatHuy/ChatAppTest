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

        public IActionResult Settings()
        {
            var username = HttpContext.Session.GetString("Username");
            if (string.IsNullOrEmpty(username))
            {
                return RedirectToAction("Login");
            }
            return View();
        }

        // Action to get current user info (used by Settings page to populate form)
        [HttpGet]
        public async Task<IActionResult> GetUserInfo()
        {
            var username = HttpContext.Session.GetString("Username");
            if (string.IsNullOrEmpty(username))
            {
                return Unauthorized(new { message = "User not logged in." });
            }

            var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
            if (user == null)
            {
                return NotFound(new { message = "User not found." });
            }

            return Json(new
            {
                username = user.Username,
                email = user.Email,
                avatarUrl = user.AvatarUrl ?? "/images/avatars/default.jpg"
            });
        }

        // Action to update user info and avatar
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> UpdateUserInfo(string email, IFormFile avatar)
        {
            var username = HttpContext.Session.GetString("Username");
            if (string.IsNullOrEmpty(username))
            {
                TempData["Error"] = "User not logged in.";
                return RedirectToAction("Login");
            }

            var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
            if (user == null)
            {
                TempData["Error"] = "User not found.";
                return RedirectToAction("Settings");
            }

            try
            {
                // Validate and update email
                if (!string.IsNullOrEmpty(email))
                {
                    if (!IsValidEmail(email))
                    {
                        TempData["Error"] = "Invalid email format.";
                        return RedirectToAction("Settings");
                    }
                    user.Email = email;
                }
                else
                {
                    TempData["Error"] = "Email is required.";
                    return RedirectToAction("Settings");
                }

                // Update avatar if provided
                if (avatar != null && avatar.Length > 0)
                {
                    var allowedExtensions = new[] { ".jpg", ".jpeg", ".png" };
                    var extension = Path.GetExtension(avatar.FileName).ToLower();
                    if (!allowedExtensions.Contains(extension))
                    {
                        TempData["Error"] = "Invalid file type. Only JPG, JPEG, and PNG are allowed.";
                        return RedirectToAction("Settings");
                    }

                    var maxFileSize = 5 * 1024 * 1024; // 5MB
                    if (avatar.Length > maxFileSize)
                    {
                        TempData["Error"] = "File size exceeds 5MB limit.";
                        return RedirectToAction("Settings");
                    }

                    var avatarDir = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot/images/avatars");
                    if (!Directory.Exists(avatarDir))
                    {
                        Directory.CreateDirectory(avatarDir);
                    }

                    var fileName = $"{username}{extension}";
                    var filePath = Path.Combine(avatarDir, fileName);

                    using (var stream = new FileStream(filePath, FileMode.Create))
                    {
                        await avatar.CopyToAsync(stream);
                    }

                    user.AvatarUrl = $"/images/avatars/{fileName}";
                }

                _context.Users.Update(user);
                await _context.SaveChangesAsync();

                TempData["Success"] = "Profile updated successfully.";
            }
            catch (Exception ex)
            {
                TempData["Error"] = $"An error occurred while updating your profile: {ex.Message}";
            }

            return RedirectToAction("Settings");
        }

        private bool IsValidEmail(string email)
        {
            if (string.IsNullOrWhiteSpace(email))
                return false;

            try
            {
                var addr = new System.Net.Mail.MailAddress(email);
                return addr.Address == email;
            }
            catch
            {
                return false;
            }
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