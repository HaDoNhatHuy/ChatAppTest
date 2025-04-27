namespace HermesChatApp.Models
{
    public class Friendship
    {
        public int Id { get; set; }
        public int UserId { get; set; }
        public User User { get; set; }
        public int FriendId { get; set; }
        public User Friend { get; set; }
        public string Status { get; set; } // "Pending" or "Accepted"
    }
}
