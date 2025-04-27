namespace HermesChatApp.Models
{
    public class User
    {
        public int Id { get; set; }
        public string Username { get; set; }
        public string Email { get; set; }
        public string PasswordHash { get; set; }
        public string? AvatarUrl { get; set; } // URL của ảnh đại diện
        public DateTime? LastOnline { get; set; } // Thêm cột LastOnline
    }
}
