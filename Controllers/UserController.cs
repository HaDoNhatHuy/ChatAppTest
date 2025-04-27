using HermesChatApp.Data;
using HermesChatApp.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;
using System.Text;

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
        public IActionResult Login(string username, string password)
        {
            var user = _context.Users.FirstOrDefault(u => u.Username == username && u.PasswordHash == password);
            if (user == null)
            {
                ViewBag.Error = "Invalid username or password.";
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
        public IActionResult Register(User user, string ConfirmPassword)
        {
            if (_context.Users.Any(u => u.Username == user.Username))
            {
                ViewBag.Error = "Username already exists.";
                return View();
            }

            if (user.PasswordHash != ConfirmPassword)
            {
                ViewBag.Error = "Passwords do not match.";
                return View();
            }
            
            _context.Users.Add(user);
            _context.SaveChanges();

            TempData["SuccessfulRegister"] = "Registration successful! Please login.";
            return RedirectToAction("Login");
        }

        public IActionResult Logout()
        {
            HttpContext.Session.Clear();
            return RedirectToAction("Login");
        }

        [HttpGet]
        public IActionResult SearchUsers(string query)
        {
            if (string.IsNullOrEmpty(query))
            {
                return Json(new { users = new List<string>() });
            }

            var currentUser = HttpContext.Session.GetString("Username");
            var users = _context.Users
                .Where(u => u.Username.Contains(query) && u.Username != currentUser)
                .Select(u => u.Username)
                .ToList();

            return Json(new { users });
        }

        //private string HashPassword(string password)
        //{
        //    using var sha256 = SHA256.Create();
        //    var bytes = Encoding.UTF8.GetBytes(password);
        //    var hash = sha256.ComputeHash(bytes);
        //    return Convert.ToBase64String(hash);
        //}

        //private bool VerifyPassword(string password, string hashedPassword)
        //{
        //    var hash = HashPassword(password);
        //    return hash == hashedPassword;
        //}
    }
}

