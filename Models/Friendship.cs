namespace HermesChatApp.Models
{
    public class Friendship
    {
        public int Id { get; set; }
        public int UserId { get; set; }
        public User User { get; set; } // Thêm navigation property cho User
        public int FriendId { get; set; }
        public User Friend { get; set; } // Thêm navigation property cho Friend
        public string Status { get; set; } // "Pending" or "Accepted"
    }
}
