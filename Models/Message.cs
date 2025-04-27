namespace HermesChatApp.Models
{
    public class Message
    {
        public int Id { get; set; }
        public string Content { get; set; }
        public string MessageType { get; set; } = "Text"; // Text, Image, File
        public string? FileUrl { get; set; }
        public DateTime Timestamp { get; set; }
        public int SenderId { get; set; }
        public User Sender { get; set; }
        public int ReceiverId { get; set; }
        public User Receiver { get; set; }
        public bool IsRead { get; set; } = false;
        public bool IsPinned { get; set; } = false;
    }
}
