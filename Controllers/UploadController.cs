using Microsoft.AspNetCore.Mvc;

namespace HermesChatApp.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class UploadController : Controller
    {
        [HttpPost]
        public async Task<IActionResult> Upload(IFormFile file)
        {
            if (file == null || file.Length == 0) return BadRequest("No file uploaded.");

            const long maxFileSize = 10 * 1024 * 1024; // 10MB
            if (file.Length > maxFileSize) return BadRequest("File size exceeds 10MB limit.");

            var allowedExtensions = new[] { ".jpg", ".jpeg", ".png", ".pdf", ".doc", ".docx", ".gif", ".webm", ".mp3" };
            var extension = Path.GetExtension(file.FileName).ToLower();
            if (!allowedExtensions.Contains(extension))
            {
                return BadRequest("File type not allowed. Allowed types: jpg, jpeg, png, pdf, doc, docx, gif, webm, mp3.");
            }

            var fileName = Guid.NewGuid() + extension;
            var filePath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot/uploads", fileName);

            var uploadsDir = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot/uploads");
            if (!Directory.Exists(uploadsDir))
            {
                Directory.CreateDirectory(uploadsDir);
            }

            using (var stream = new FileStream(filePath, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }

            // Trả về cả fileUrl và fileSize
            return Ok(new { fileUrl = $"/uploads/{fileName}", fileSize = file.Length });
        }
    }
}