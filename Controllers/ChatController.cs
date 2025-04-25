using Microsoft.AspNetCore.Mvc;

namespace HermesChatApp.Controllers
{
    public class ChatController : Controller
    {
        public IActionResult Index()
        {
            // Lấy username từ session
            var username = HttpContext.Session.GetString("Username");
            if (string.IsNullOrEmpty(username))
            {
                // Nếu không có username trong session, chuyển hướng về trang đăng nhập
                return RedirectToAction("Login", "User");
            }

            // Gán username vào ViewBag
            ViewBag.Username = username;
            return View();
        }
    }
}
