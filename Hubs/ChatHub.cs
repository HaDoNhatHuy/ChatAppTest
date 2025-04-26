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
                await NotifyFriendsOfStatusChange(username, true);
            }
            await base.OnConnectedAsync();
        }

        public override async Task OnDisconnectedAsync(Exception exception)
        {
            var username = _userConnections.FirstOrDefault(x => x.Value == Context.ConnectionId).Key;
            if (username != null)
            {
                _userConnections.TryRemove(username, out _);
                await NotifyFriendsOfStatusChange(username, false);
            }
            await base.OnDisconnectedAsync(exception);
        }

        private async Task NotifyFriendsOfStatusChange(string username, bool isOnline)
        {
            var user = _context.Users.FirstOrDefault(u => u.Username == username);
            if (user == null) return;

            var friends = _context.Friendships
                .Where(f => (f.UserId == user.Id || f.FriendId == user.Id) && f.Status == "Accepted")
                .Select(f => f.UserId == user.Id ? f.FriendId : f.FriendId == user.Id ? f.UserId : 0)
                .ToList();

            var friendUsernames = friends.Select(f => _context.Users.Find(f).Username).ToList();
            foreach (var friend in friendUsernames)
            {
                if (_userConnections.TryGetValue(friend, out var friendConnectionId))
                {
                    await Clients.Client(friendConnectionId).SendAsync("ReceiveUserStatus", username, isOnline);
                }
            }
        }

        public async Task SendMessage(string sender, string receiver, string message)
        {
            var senderUser = _context.Users.FirstOrDefault(u => u.Username == sender);
            var receiverUser = _context.Users.FirstOrDefault(u => u.Username == receiver);
            if (senderUser == null || receiverUser == null)
            {
                throw new HubException("Sender or receiver not found.");
            }

            var msg = new Message
            {
                Content = message,
                SenderId = senderUser.Id,
                ReceiverId = receiverUser.Id,
                Timestamp = DateTime.Now
            };
            _context.Messages.Add(msg);
            await _context.SaveChangesAsync();

            var senderConnectionId = _userConnections.GetValueOrDefault(sender);
            var receiverConnectionId = _userConnections.GetValueOrDefault(receiver);
            if (senderConnectionId != null)
            {
                await Clients.Client(senderConnectionId).SendAsync("ReceiveMessage", sender, message, receiver);
            }
            if (receiverConnectionId != null)
            {
                await Clients.Client(receiverConnectionId).SendAsync("ReceiveMessage", sender, message, receiver);
            }
        }

        public async Task LoadMessages(string currentUser, string friend)
        {
            var currentUserEntity = _context.Users.FirstOrDefault(u => u.Username == currentUser);
            var friendEntity = _context.Users.FirstOrDefault(u => u.Username == friend);
            if (currentUserEntity == null || friendEntity == null)
            {
                throw new HubException("User or friend not found.");
            }

            var messages = _context.Messages
                .Where(m =>
                    (m.SenderId == currentUserEntity.Id && m.ReceiverId == friendEntity.Id) ||
                    (m.SenderId == friendEntity.Id && m.ReceiverId == currentUserEntity.Id))
                .OrderBy(m => m.Timestamp)
                .Take(50);

            foreach (var msg in messages)
            {
                var sender = _context.Users.Find(msg.SenderId).Username;
                await Clients.Caller.SendAsync("ReceiveMessage", sender, msg.Content, friend);
            }
        }

        public async Task SendFriendRequest(string sender, string receiver)
        {
            var senderUser = _context.Users.FirstOrDefault(u => u.Username == sender);
            var receiverUser = _context.Users.FirstOrDefault(u => u.Username == receiver);
            if (senderUser == null || receiverUser == null)
            {
                throw new HubException("Sender or receiver not found.");
            }

            var existingFriendship = _context.Friendships.FirstOrDefault(f =>
                (f.UserId == senderUser.Id && f.FriendId == receiverUser.Id) ||
                (f.UserId == receiverUser.Id && f.FriendId == senderUser.Id));
            if (existingFriendship != null)
            {
                throw new HubException("Friendship already exists.");
            }

            var friendship = new Friendship
            {
                UserId = senderUser.Id,
                FriendId = receiverUser.Id,
                Status = "Pending"
            };
            _context.Friendships.Add(friendship);
            await _context.SaveChangesAsync();

            var receiverConnectionId = _userConnections.GetValueOrDefault(receiver);
            if (receiverConnectionId != null)
            {
                await Clients.Client(receiverConnectionId).SendAsync("ReceiveFriendRequest", sender);
            }
        }

        public async Task AcceptFriendRequest(string accepter, string requester)
        {
            var accepterUser = _context.Users.FirstOrDefault(u => u.Username == accepter);
            var requesterUser = _context.Users.FirstOrDefault(u => u.Username == requester);
            if (accepterUser == null || requesterUser == null)
            {
                throw new HubException("User or requester not found.");
            }

            var friendship = _context.Friendships.FirstOrDefault(f =>
                f.UserId == requesterUser.Id && f.FriendId == accepterUser.Id && f.Status == "Pending");
            if (friendship == null)
            {
                throw new HubException("Friend request not found.");
            }

            friendship.Status = "Accepted";
            _context.Friendships.Update(friendship);
            await _context.SaveChangesAsync();

            var accepterConnectionId = _userConnections.GetValueOrDefault(accepter);
            var requesterConnectionId = _userConnections.GetValueOrDefault(requester);
            if (accepterConnectionId != null)
            {
                await Clients.Client(accepterConnectionId).SendAsync("FriendRequestAccepted", requester);
                await NotifyFriendsOfStatusChange(requester, _userConnections.ContainsKey(requester));
            }
            if (requesterConnectionId != null)
            {
                await Clients.Client(requesterConnectionId).SendAsync("FriendRequestAccepted", accepter);
                await NotifyFriendsOfStatusChange(accepter, _userConnections.ContainsKey(accepter));
            }
        }

        public async Task DeclineFriendRequest(string decliner, string requester)
        {
            var declinerUser = _context.Users.FirstOrDefault(u => u.Username == decliner);
            var requesterUser = _context.Users.FirstOrDefault(u => u.Username == requester);
            if (declinerUser == null || requesterUser == null)
            {
                throw new HubException("User or requester not found.");
            }

            var friendship = _context.Friendships.FirstOrDefault(f =>
                f.UserId == requesterUser.Id && f.FriendId == declinerUser.Id && f.Status == "Pending");
            if (friendship == null)
            {
                throw new HubException("Friend request not found.");
            }

            _context.Friendships.Remove(friendship);
            await _context.SaveChangesAsync();

            var requesterConnectionId = _userConnections.GetValueOrDefault(requester);
            if (requesterConnectionId != null)
            {
                await Clients.Client(requesterConnectionId).SendAsync("FriendRequestDeclined", decliner);
            }
        }

        public async Task GetFriends(string username)
        {
            var user = _context.Users.FirstOrDefault(u => u.Username == username);
            if (user == null)
            {
                throw new HubException("User not found.");
            }

            var friends = _context.Friendships
                .Where(f => (f.UserId == user.Id || f.FriendId == user.Id) && f.Status == "Accepted")
                .Select(f => f.UserId == user.Id ? f.FriendId : f.FriendId == user.Id ? f.UserId : 0)
                .ToList();

            var friendUsernames = friends.Select(f => _context.Users.Find(f).Username).ToList();
            var friendStatuses = friendUsernames.ToDictionary(
                friend => friend,
                friend => _userConnections.ContainsKey(friend)
            );
            await Clients.Caller.SendAsync("ReceiveFriends", friendUsernames, friendStatuses);
        }

        public async Task GetFriendRequests(string username)
        {
            var user = _context.Users.FirstOrDefault(u => u.Username == username);
            if (user == null)
            {
                throw new HubException("User not found.");
            }

            var requests = _context.Friendships
                .Where(f => f.FriendId == user.Id && f.Status == "Pending")
                .Select(f => _context.Users.Find(f.UserId).Username)
                .ToList();

            await Clients.Caller.SendAsync("ReceiveFriendRequests", requests);
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
                Console.WriteLine($"Sending signal from {sender} to {targetUser} (ConnectionId: {targetConnectionId})");
                await Clients.Client(targetConnectionId).SendAsync("ReceiveSignal", sender, signalData);
            }
            else
            {
                throw new HubException($"User {targetUser} not found or not online.");
            }
        }

        public async Task SendCallEnded(string targetUser)
        {
            var sender = _userConnections.FirstOrDefault(x => x.Value == Context.ConnectionId).Key;
            if (string.IsNullOrEmpty(sender))
            {
                throw new HubException("Sender not found.");
            }

            if (_userConnections.TryGetValue(targetUser, out var targetConnectionId))
            {
                await Clients.Client(targetConnectionId).SendAsync("CallEnded", sender);
            }
            else
            {
                throw new HubException($"User {targetUser} not found or not online.");
            }
        }
    }
}
