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
            try
            {
                var username = Context.GetHttpContext()?.Request.Query["username"];
                if (!string.IsNullOrEmpty(username))
                {
                    _userConnections[username] = Context.ConnectionId;
                    await NotifyFriendsOfStatusChange(username, true);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in OnConnectedAsync: {ex.Message}");
            }
            await base.OnConnectedAsync();
        }

        public override async Task OnDisconnectedAsync(Exception exception)
        {
            try
            {
                var username = _userConnections.FirstOrDefault(x => x.Value == Context.ConnectionId).Key;
                if (username != null)
                {
                    _userConnections.TryRemove(username, out _);
                    await NotifyFriendsOfStatusChange(username, false);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in OnDisconnectedAsync: {ex.Message}");
            }
            await base.OnDisconnectedAsync(exception);
        }

        private async Task NotifyFriendsOfStatusChange(string username, bool isOnline)
        {
            try
            {
                var user = _context.Users.FirstOrDefault(u => u.Username == username);
                if (user == null) return;

                var friends = _context.Friendships
                    .Where(f => (f.UserId == user.Id || f.FriendId == user.Id) && f.Status == "Accepted")
                    .Select(f => f.UserId == user.Id ? f.FriendId : f.FriendId == user.Id ? f.UserId : 0)
                    .ToList();

                var friendUsernames = friends.Select(f => _context.Users.FirstOrDefault(u => u.Id == f)?.Username).ToList();
                foreach (var friend in friendUsernames)
                {
                    if (friend != null && _userConnections.TryGetValue(friend, out var friendConnectionId))
                    {
                        await Clients.Client(friendConnectionId).SendAsync("ReceiveUserStatus", username, isOnline);
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in NotifyFriendsOfStatusChange: {ex.Message}");
            }
        }

        public async Task SendMessage(string sender, string receiver, string message)
        {
            try
            {
                var senderUser = _context.Users.FirstOrDefault(u => u.Username == sender);
                var receiverUser = _context.Users.FirstOrDefault(u => u.Username == receiver);
                if (senderUser == null || receiverUser == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "Sender or receiver not found.");
                    return;
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
            catch (Exception ex)
            {
                Console.WriteLine($"Error in SendMessage: {ex.Message}");
                await Clients.Caller.SendAsync("ReceiveError", "Failed to send message.");
            }
        }

        public async Task LoadMessages(string currentUser, string friend)
        {
            try
            {
                var currentUserEntity = _context.Users.FirstOrDefault(u => u.Username == currentUser);
                var friendEntity = _context.Users.FirstOrDefault(u => u.Username == friend);
                if (currentUserEntity == null || friendEntity == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "User or friend not found.");
                    return;
                }

                var messages = _context.Messages
                    .Where(m =>
                        (m.SenderId == currentUserEntity.Id && m.ReceiverId == friendEntity.Id) ||
                        (m.SenderId == friendEntity.Id && m.ReceiverId == currentUserEntity.Id))
                    .OrderBy(m => m.Timestamp)
                    .Take(50)
                    .ToList();

                foreach (var msg in messages)
                {
                    var sender = _context.Users.FirstOrDefault(u => u.Id == msg.SenderId)?.Username;
                    var receiver = _context.Users.FirstOrDefault(u => u.Id == msg.ReceiverId)?.Username;
                    if (sender != null && receiver != null)
                    {
                        await Clients.Caller.SendAsync("ReceiveMessage", sender, msg.Content, receiver);
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in LoadMessages: {ex.Message}");
                await Clients.Caller.SendAsync("ReceiveError", "Failed to load messages.");
            }
        }

        public async Task SendFriendRequest(string sender, string receiver)
        {
            try
            {
                Console.WriteLine($"Received friend request: Sender = {sender}, Receiver = {receiver}");

                var senderUser = _context.Users.FirstOrDefault(u => u.Username == sender);
                var receiverUser = _context.Users.FirstOrDefault(u => u.Username == receiver);
                if (senderUser == null || receiverUser == null)
                {
                    Console.WriteLine("Sender or receiver not found in database.");
                    await Clients.Caller.SendAsync("ReceiveError", "Sender or receiver not found.");
                    return;
                }

                var existingFriendship = _context.Friendships.FirstOrDefault(f =>
                    (f.UserId == senderUser.Id && f.FriendId == receiverUser.Id) ||
                    (f.UserId == receiverUser.Id && f.FriendId == senderUser.Id));

                if (existingFriendship != null)
                {
                    if (existingFriendship.Status == "Accepted")
                    {
                        Console.WriteLine($"{receiver} is already a friend of {sender}.");
                        await Clients.Caller.SendAsync("ReceiveError", $"{receiver} is already your friend.");
                        return;
                    }
                    else if (existingFriendship.Status == "Pending")
                    {
                        if (existingFriendship.UserId == senderUser.Id)
                        {
                            Console.WriteLine($"{sender} has already sent a friend request to {receiver}.");
                            await Clients.Caller.SendAsync("ReceiveError", $"You have already sent a friend request to {receiver}.");
                            return;
                        }
                        else
                        {
                            Console.WriteLine($"{receiver} has already sent a friend request to {sender}.");
                            await Clients.Caller.SendAsync("ReceiveError", $"{receiver} has already sent you a friend request.");
                            return;
                        }
                    }
                }

                var friendship = new Friendship
                {
                    UserId = senderUser.Id,
                    FriendId = receiverUser.Id,
                    Status = "Pending"
                };
                Console.WriteLine($"Adding new friendship: {sender} -> {receiver}");
                _context.Friendships.Add(friendship);
                await _context.SaveChangesAsync();
                Console.WriteLine("Friendship saved to database.");

                var receiverConnectionId = _userConnections.GetValueOrDefault(receiver);
                if (receiverConnectionId != null)
                {
                    Console.WriteLine($"Notifying receiver {receiver} (ConnectionId: {receiverConnectionId})");
                    await Clients.Client(receiverConnectionId).SendAsync("ReceiveFriendRequest", sender);
                }
                else
                {
                    Console.WriteLine($"{receiver} is not online, skipping notification.");
                }

                Console.WriteLine($"Sending success message to {sender}");
                await Clients.Caller.SendAsync("ReceiveSuccess", $"Friend request sent to {receiver}.");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in SendFriendRequest: {ex.Message}");
                await Clients.Caller.SendAsync("ReceiveError", "Failed to send friend request.");
            }
        }

        public async Task AcceptFriendRequest(string accepter, string requester)
        {
            try
            {
                var accepterUser = _context.Users.FirstOrDefault(u => u.Username == accepter);
                var requesterUser = _context.Users.FirstOrDefault(u => u.Username == requester);
                if (accepterUser == null || requesterUser == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "User or requester not found.");
                    return;
                }

                var friendship = _context.Friendships.FirstOrDefault(f =>
                    f.UserId == requesterUser.Id && f.FriendId == accepterUser.Id && f.Status == "Pending");
                if (friendship == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "Friend request not found.");
                    return;
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
            catch (Exception ex)
            {
                Console.WriteLine($"Error in AcceptFriendRequest: {ex.Message}");
                await Clients.Caller.SendAsync("ReceiveError", "Failed to accept friend request.");
            }
        }

        public async Task DeclineFriendRequest(string decliner, string requester)
        {
            try
            {
                var declinerUser = _context.Users.FirstOrDefault(u => u.Username == decliner);
                var requesterUser = _context.Users.FirstOrDefault(u => u.Username == requester);
                if (declinerUser == null || requesterUser == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "User or requester not found.");
                    return;
                }

                var friendship = _context.Friendships.FirstOrDefault(f =>
                    f.UserId == requesterUser.Id && f.FriendId == declinerUser.Id && f.Status == "Pending");
                if (friendship == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "Friend request not found.");
                    return;
                }

                _context.Friendships.Remove(friendship);
                await _context.SaveChangesAsync();

                var requesterConnectionId = _userConnections.GetValueOrDefault(requester);
                if (requesterConnectionId != null)
                {
                    await Clients.Client(requesterConnectionId).SendAsync("FriendRequestDeclined", decliner);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in DeclineFriendRequest: {ex.Message}");
                await Clients.Caller.SendAsync("ReceiveError", "Failed to decline friend request.");
            }
        }

        public async Task GetFriends(string username)
        {
            try
            {
                var user = _context.Users.FirstOrDefault(u => u.Username == username);
                if (user == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "User not found.");
                    return;
                }

                var friends = _context.Friendships
                    .Where(f => (f.UserId == user.Id || f.FriendId == user.Id) && f.Status == "Accepted")
                    .Select(f => f.UserId == user.Id ? f.FriendId : f.FriendId == user.Id ? f.UserId : 0)
                    .ToList();

                var friendUsernames = friends.Select(f => _context.Users.FirstOrDefault(u => u.Id == f)?.Username).ToList();
                var friendStatuses = friendUsernames.ToDictionary(
                    friend => friend,
                    friend => _userConnections.ContainsKey(friend)
                );
                await Clients.Caller.SendAsync("ReceiveFriends", friendUsernames, friendStatuses);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in GetFriends: {ex.Message}");
                await Clients.Caller.SendAsync("ReceiveError", "Failed to load friends.");
            }
        }

        public async Task GetFriendRequests(string username)
        {
            try
            {
                var user = _context.Users.FirstOrDefault(u => u.Username == username);
                if (user == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "User not found.");
                    return;
                }

                var requestUserIds = _context.Friendships
                    .Where(f => f.FriendId == user.Id && f.Status == "Pending")
                    .Select(f => f.UserId)
                    .ToList();

                var requests = new List<string>();
                foreach (var userId in requestUserIds)
                {
                    var requester = _context.Users.FirstOrDefault(u => u.Id == userId);
                    if (requester != null)
                    {
                        requests.Add(requester.Username);
                    }
                }

                await Clients.Caller.SendAsync("ReceiveFriendRequests", requests);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in GetFriendRequests: {ex.Message}");
                await Clients.Caller.SendAsync("ReceiveError", "Failed to load friend requests.");
            }
        }

        public async Task SendSignal(string targetUser, string signalData)
        {
            try
            {
                var sender = _userConnections.FirstOrDefault(x => x.Value == Context.ConnectionId).Key;
                if (string.IsNullOrEmpty(sender))
                {
                    await Clients.Caller.SendAsync("ReceiveError", "Sender not found.");
                    return;
                }

                if (_userConnections.TryGetValue(targetUser, out var targetConnectionId))
                {
                    Console.WriteLine($"Sending signal from {sender} to {targetUser} (ConnectionId: {targetConnectionId})");
                    await Clients.Client(targetConnectionId).SendAsync("ReceiveSignal", sender, signalData);
                }
                else
                {
                    await Clients.Caller.SendAsync("ReceiveError", $"User {targetUser} not found or not online.");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in SendSignal: {ex.Message}");
                await Clients.Caller.SendAsync("ReceiveError", "Failed to send signal.");
            }
        }

        public async Task SendCallEnded(string targetUser)
        {
            try
            {
                var sender = _userConnections.FirstOrDefault(x => x.Value == Context.ConnectionId).Key;
                if (string.IsNullOrEmpty(sender))
                {
                    await Clients.Caller.SendAsync("ReceiveError", "Sender not found.");
                    return;
                }

                if (_userConnections.TryGetValue(targetUser, out var targetConnectionId))
                {
                    await Clients.Client(targetConnectionId).SendAsync("CallEnded", sender);
                }
                else
                {
                    await Clients.Caller.SendAsync("ReceiveError", $"User {targetUser} not found or not online.");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in SendCallEnded: {ex.Message}");
                await Clients.Caller.SendAsync("ReceiveError", "Failed to end call.");
            }
        }
    }
}