using HermesChatApp.Data;
using HermesChatApp.Models;
using Microsoft.AspNetCore.SignalR;
using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using System.Threading.Tasks;


namespace HermesChatApp.Hubs
{
    public class ChatHub : Hub
    {
        private readonly AppDbContext _context;
        private static readonly ConcurrentDictionary<string, string> _userConnections = new ConcurrentDictionary<string, string>();

        public ChatHub(AppDbContext context)
        {
            _context = context;
        }

        public override async Task OnConnectedAsync()
        {
            var username = Context.GetHttpContext().Request.Query["username"];
            if (!string.IsNullOrEmpty(username))
            {
                _userConnections[username] = Context.ConnectionId;
                await Clients.All.SendAsync("ReceiveUsersOnline", _userConnections.Keys.ToList());
            }
            await base.OnConnectedAsync();
        }

        public override async Task OnDisconnectedAsync(Exception exception)
        {
            var username = _userConnections.FirstOrDefault(x => x.Value == Context.ConnectionId).Key;
            if (username != null)
            {
                _userConnections.TryRemove(username, out _);
                await Clients.All.SendAsync("ReceiveUsersOnline", _userConnections.Keys.ToList());
            }
            await base.OnDisconnectedAsync(exception);
        }

        public async Task SendMessage(string user, string message, string room)
        {
            var sender = _context.Users.FirstOrDefault(u => u.Username == user);
            if (sender == null)
            {
                throw new HubException($"User {user} not found.");
            }

            var msg = new Message
            {
                Content = message,
                SenderId = sender.Id,
                Timestamp = DateTime.Now,
                Room = room
            };
            _context.Messages.Add(msg);
            await _context.SaveChangesAsync();
            await Clients.Group(room).SendAsync("ReceiveMessage", user, message);
        }

        public async Task JoinRoom(string room)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, room);
            var messages = _context.Messages.Where(m => m.Room == room).OrderBy(m => m.Timestamp).Take(50);
            foreach (var msg in messages)
            {
                var sender = _context.Users.Find(msg.SenderId).Username;
                await Clients.Caller.SendAsync("ReceiveMessage", sender, msg.Content);
            }
        }

        public async Task GetUsersOnline()
        {
            var users = _context.Users.Select(u => u.Username).ToList();
            await Clients.All.SendAsync("ReceiveUsersOnline", users);
        }

        public async Task SendSignal(string targetUser, string signalData)
        {
            var sender = _userConnections.FirstOrDefault(x => x.Value == Context.ConnectionId).Key;
            if (string.IsNullOrEmpty(sender))
            {
                throw new HubException("Sender not found.");
            }

            if (_userConnections.TryGetValue(targetUser, out var targetConnectionId))
            {
                // Log để kiểm tra xem tín hiệu có được gửi hay không
                Console.WriteLine($"Sending signal from {sender} to {targetUser} (ConnectionId: {targetConnectionId})");
                await Clients.Client(targetConnectionId).SendAsync("ReceiveSignal", sender, signalData);
            }
            else
            {
                throw new HubException($"User {targetUser} not found or not online.");
            }
        }
    }
}
