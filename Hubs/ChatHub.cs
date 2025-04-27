using HermesChatApp.Data;
using HermesChatApp.Models;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.Collections.Concurrent;
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
                var username = Context.GetHttpContext()?.Request.Query["username"].ToString();
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

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            try
            {
                var username = _userConnections.FirstOrDefault(x => x.Value == Context.ConnectionId).Key;
                if (username != null)
                {
                    var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
                    if (user != null)
                    {
                        user.LastOnline = DateTime.UtcNow;
                        _context.Users.Update(user);
                        await _context.SaveChangesAsync();
                    }
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
                var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
                if (user == null) return;

                var friends = await _context.Friendships
                    .Where(f => (f.UserId == user.Id || f.FriendId == user.Id) && f.Status == "Accepted")
                    .Join(_context.Users,
                        f => f.UserId == user.Id ? f.FriendId : f.UserId,
                        u => u.Id,
                        (f, u) => u.Username)
                    .ToListAsync();

                foreach (var friend in friends)
                {
                    if (_userConnections.TryGetValue(friend, out var friendConnectionId))
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
                var senderUser = await _context.Users.FirstOrDefaultAsync(u => u.Username == sender);
                var receiverUser = await _context.Users.FirstOrDefaultAsync(u => u.Username == receiver);
                if (senderUser == null || receiverUser == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "Sender or receiver not found.");
                    return;
                }

                var msg = new Message
                {
                    Content = message,
                    MessageType = "Text",
                    SenderId = senderUser.Id,
                    ReceiverId = receiverUser.Id,
                    Timestamp = DateTime.UtcNow,
                    IsRead = false
                };
                _context.Messages.Add(msg);
                await _context.SaveChangesAsync();

                var senderConnectionId = _userConnections.GetValueOrDefault(sender);
                var receiverConnectionId = _userConnections.GetValueOrDefault(receiver);
                if (senderConnectionId != null)
                {
                    await Clients.Client(senderConnectionId).SendAsync("ReceiveMessage", sender, message, receiver, msg.MessageType, null, msg.IsPinned, msg.Id, msg.Timestamp.ToString("o"));
                }
                if (receiverConnectionId != null)
                {
                    await Clients.Client(receiverConnectionId).SendAsync("ReceiveMessage", sender, message, receiver, msg.MessageType, null, msg.IsPinned, msg.Id, msg.Timestamp.ToString("o"));
                    await Clients.Client(receiverConnectionId).SendAsync("ReceiveNewMessageNotification", sender);
                }
                await GetUnreadCounts(receiver);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in SendMessage: {ex.Message}");
                await Clients.Caller.SendAsync("ReceiveError", "Failed to send message.");
            }
        }

        public async Task SendFileMessage(string sender, string receiver, string fileUrl, string messageType)
        {
            try
            {
                var senderUser = await _context.Users.FirstOrDefaultAsync(u => u.Username == sender);
                var receiverUser = await _context.Users.FirstOrDefaultAsync(u => u.Username == receiver);
                if (senderUser == null || receiverUser == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "Sender or receiver not found.");
                    return;
                }

                var msg = new Message
                {
                    Content = "",
                    MessageType = messageType,
                    FileUrl = fileUrl,
                    SenderId = senderUser.Id,
                    ReceiverId = receiverUser.Id,
                    Timestamp = DateTime.UtcNow,
                    IsRead = false
                };
                _context.Messages.Add(msg);
                await _context.SaveChangesAsync();

                var senderConnectionId = _userConnections.GetValueOrDefault(sender);
                var receiverConnectionId = _userConnections.GetValueOrDefault(receiver);
                if (senderConnectionId != null)
                {
                    await Clients.Client(senderConnectionId).SendAsync("ReceiveMessage", sender, "", receiver, messageType, fileUrl, msg.IsPinned, msg.Id, msg.Timestamp.ToString("o"));
                }
                if (receiverConnectionId != null)
                {
                    await Clients.Client(receiverConnectionId).SendAsync("ReceiveMessage", sender, "", receiver, messageType, fileUrl, msg.IsPinned, msg.Id, msg.Timestamp.ToString("o"));
                    await Clients.Client(receiverConnectionId).SendAsync("ReceiveNewMessageNotification", sender);
                }
                await GetUnreadCounts(receiver);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in SendFileMessage: {ex.Message}");
                await Clients.Caller.SendAsync("ReceiveError", "Failed to send file.");
            }
        }

        public async Task LoadMessages(string currentUser, string friend)
        {
            try
            {
                var currentUserEntity = await _context.Users.FirstOrDefaultAsync(u => u.Username == currentUser);
                var friendEntity = await _context.Users.FirstOrDefaultAsync(u => u.Username == friend);
                if (currentUserEntity == null || friendEntity == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "User or friend not found.");
                    return;
                }

                var messages = await _context.Messages
                    .Where(m =>
                        (m.SenderId == currentUserEntity.Id && m.ReceiverId == friendEntity.Id) ||
                        (m.SenderId == friendEntity.Id && m.ReceiverId == currentUserEntity.Id))
                    .OrderBy(m => m.Timestamp)
                    .Take(50)
                    .Select(m => new
                    {
                        m.Id,
                        m.Content,
                        m.MessageType,
                        m.FileUrl,
                        m.IsPinned,
                        m.Timestamp,
                        SenderUsername = m.Sender.Username,
                        ReceiverUsername = m.Receiver.Username
                    })
                    .ToListAsync();

                foreach (var msg in messages)
                {
                    await Clients.Caller.SendAsync("ReceiveMessage", msg.SenderUsername, msg.Content, msg.ReceiverUsername, msg.MessageType, msg.FileUrl, msg.IsPinned, msg.Id, msg.Timestamp.ToString("o"));
                }

                await MarkMessagesAsRead(currentUser, friend);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in LoadMessages: {ex.Message}");
                await Clients.Caller.SendAsync("ReceiveError", "Failed to load messages.");
            }
        }

        public async Task PinMessage(string user, int messageId)
        {
            try
            {
                var message = await _context.Messages.FirstOrDefaultAsync(m => m.Id == messageId);
                if (message == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "Message not found.");
                    return;
                }

                message.IsPinned = true;
                _context.Messages.Update(message);
                await _context.SaveChangesAsync();

                var sender = _context.Users.FirstOrDefault(u => u.Id == message.SenderId)?.Username;
                var receiver = _context.Users.FirstOrDefault(u => u.Id == message.ReceiverId)?.Username;
                if (sender != null && receiver != null)
                {
                    var senderConnectionId = _userConnections.GetValueOrDefault(sender);
                    var receiverConnectionId = _userConnections.GetValueOrDefault(receiver);
                    if (senderConnectionId != null)
                    {
                        await Clients.Client(senderConnectionId).SendAsync("MessagePinned", messageId, true);
                    }
                    if (receiverConnectionId != null)
                    {
                        await Clients.Client(receiverConnectionId).SendAsync("MessagePinned", messageId, true);
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in PinMessage: {ex.Message}");
                await Clients.Caller.SendAsync("ReceiveError", "Failed to pin message.");
            }
        }

        public async Task UnpinMessage(string user, int messageId)
        {
            try
            {
                var message = await _context.Messages.FirstOrDefaultAsync(m => m.Id == messageId);
                if (message == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "Message not found.");
                    return;
                }

                message.IsPinned = false;
                _context.Messages.Update(message);
                await _context.SaveChangesAsync();

                var sender = _context.Users.FirstOrDefault(u => u.Id == message.SenderId)?.Username;
                var receiver = _context.Users.FirstOrDefault(u => u.Id == message.ReceiverId)?.Username;
                if (sender != null && receiver != null)
                {
                    var senderConnectionId = _userConnections.GetValueOrDefault(sender);
                    var receiverConnectionId = _userConnections.GetValueOrDefault(receiver);
                    if (senderConnectionId != null)
                    {
                        await Clients.Client(senderConnectionId).SendAsync("MessagePinned", messageId, false);
                    }
                    if (receiverConnectionId != null)
                    {
                        await Clients.Client(receiverConnectionId).SendAsync("MessagePinned", messageId, false);
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in UnpinMessage: {ex.Message}");
                await Clients.Caller.SendAsync("ReceiveError", "Failed to unpin message.");
            }
        }

        public async Task SendTyping(string sender, string receiver)
        {
            try
            {
                var receiverConnectionId = _userConnections.GetValueOrDefault(receiver);
                if (receiverConnectionId != null)
                {
                    await Clients.Client(receiverConnectionId).SendAsync("ReceiveTyping", sender);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in SendTyping: {ex.Message}");
            }
        }

        public async Task StopTyping(string sender, string receiver)
        {
            try
            {
                var receiverConnectionId = _userConnections.GetValueOrDefault(receiver);
                if (receiverConnectionId != null)
                {
                    await Clients.Client(receiverConnectionId).SendAsync("ReceiveStopTyping", sender);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in StopTyping: {ex.Message}");
            }
        }

        public async Task MarkMessagesAsRead(string user, string friend)
        {
            try
            {
                var userEntity = await _context.Users.FirstOrDefaultAsync(u => u.Username == user);
                var friendEntity = await _context.Users.FirstOrDefaultAsync(u => u.Username == friend);
                if (userEntity == null || friendEntity == null) return;

                var messages = await _context.Messages
                    .Where(m => m.ReceiverId == userEntity.Id && m.SenderId == friendEntity.Id && !m.IsRead)
                    .ToListAsync();
                foreach (var msg in messages)
                {
                    msg.IsRead = true;
                }
                await _context.SaveChangesAsync();
                await GetUnreadCounts(user);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in MarkMessagesAsRead: {ex.Message}");
            }
        }

        public async Task GetUnreadCounts(string username)
        {
            try
            {
                var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
                if (user == null) return;

                var friends = await _context.Friendships
                    .Where(f => (f.UserId == user.Id || f.FriendId == user.Id) && f.Status == "Accepted")
                    .Select(f => f.UserId == user.Id ? f.FriendId : f.FriendId == user.Id ? f.UserId : 0)
                    .ToListAsync();

                var unreadCounts = new Dictionary<string, int>();
                foreach (var friendId in friends)
                {
                    var friend = await _context.Users.FirstOrDefaultAsync(u => u.Id == friendId);
                    if (friend != null)
                    {
                        var count = await _context.Messages
                            .Where(m => m.ReceiverId == user.Id && m.SenderId == friendId && !m.IsRead)
                            .CountAsync();
                        unreadCounts[friend.Username] = count;
                    }
                }
                var connectionId = _userConnections.GetValueOrDefault(username);
                if (connectionId != null)
                {
                    await Clients.Client(connectionId).SendAsync("ReceiveUnreadCounts", unreadCounts);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in GetUnreadCounts: {ex.Message}");
            }
        }

        public async Task SendFriendRequest(string sender, string receiver)
        {
            try
            {
                var senderUser = await _context.Users.FirstOrDefaultAsync(u => u.Username == sender);
                var receiverUser = await _context.Users.FirstOrDefaultAsync(u => u.Username == receiver);
                if (senderUser == null || receiverUser == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "Sender or receiver not found.");
                    return;
                }

                var existingFriendship = await _context.Friendships.FirstOrDefaultAsync(f =>
                    (f.UserId == senderUser.Id && f.FriendId == receiverUser.Id) ||
                    (f.UserId == receiverUser.Id && f.FriendId == senderUser.Id));

                if (existingFriendship != null)
                {
                    if (existingFriendship.Status == "Accepted")
                    {
                        await Clients.Caller.SendAsync("ReceiveError", $"{receiver} is already your friend.");
                        return;
                    }
                    else if (existingFriendship.Status == "Pending")
                    {
                        if (existingFriendship.UserId == senderUser.Id)
                        {
                            await Clients.Caller.SendAsync("ReceiveError", $"You have already sent a friend request to {receiver}.");
                            return;
                        }
                        else
                        {
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
                _context.Friendships.Add(friendship);
                await _context.SaveChangesAsync();

                var receiverConnectionId = _userConnections.GetValueOrDefault(receiver);
                if (receiverConnectionId != null)
                {
                    await Clients.Client(receiverConnectionId).SendAsync("ReceiveFriendRequest", sender);
                }

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
                var accepterUser = await _context.Users.FirstOrDefaultAsync(u => u.Username == accepter);
                var requesterUser = await _context.Users.FirstOrDefaultAsync(u => u.Username == requester);
                if (accepterUser == null || requesterUser == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "User or requester not found.");
                    return;
                }

                var friendship = await _context.Friendships.FirstOrDefaultAsync(f =>
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
                var declinerUser = await _context.Users.FirstOrDefaultAsync(u => u.Username == decliner);
                var requesterUser = await _context.Users.FirstOrDefaultAsync(u => u.Username == requester);
                if (declinerUser == null || requesterUser == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "User or requester not found.");
                    return;
                }

                var friendship = await _context.Friendships.FirstOrDefaultAsync(f =>
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
                var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
                if (user == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "User not found.");
                    return;
                }

                var friends = await _context.Friendships
                    .Where(f => (f.UserId == user.Id || f.FriendId == user.Id) && f.Status == "Accepted")
                    .Select(f => f.UserId == user.Id ? f.FriendId : f.FriendId == user.Id ? f.UserId : 0)
                    .ToListAsync();

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
                var user = await _context.Users.FirstOrDefaultAsync(u => u.Username == username);
                if (user == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "User not found.");
                    return;
                }

                var requestUserIds = await _context.Friendships
                    .Where(f => f.FriendId == user.Id && f.Status == "Pending")
                    .Select(f => f.UserId)
                    .ToListAsync();

                var requests = new List<string>();
                foreach (var userId in requestUserIds)
                {
                    var requester = await _context.Users.FirstOrDefaultAsync(u => u.Id == userId);
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

        public async Task GetLastOnline(string username, string friend)
        {
            try
            {
                var friendEntity = await _context.Users.FirstOrDefaultAsync(u => u.Username == friend);
                if (friendEntity == null)
                {
                    await Clients.Caller.SendAsync("ReceiveError", "User not found.");
                    return;
                }

                var lastOnline = friendEntity.LastOnline?.ToString("o") ?? null;
                await Clients.Caller.SendAsync("ReceiveLastOnline", friend, lastOnline);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in GetLastOnline: {ex.Message}");
                await Clients.Caller.SendAsync("ReceiveError", "Failed to get last online time.");
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
        public async Task LoadOlderMessages(string currentUser, string friend, int oldestMessageId)
        {
            var currentUserEntity = await _context.Users.FirstOrDefaultAsync(u => u.Username == currentUser);
            var friendEntity = await _context.Users.FirstOrDefaultAsync(u => u.Username == friend);

            if (currentUserEntity == null || friendEntity == null)
            {
                await Clients.Caller.SendAsync("ReceiveError", "User not found.");
                return;
            }

            var messages = await _context.Messages
                .Where(m =>
                    ((m.SenderId == currentUserEntity.Id && m.ReceiverId == friendEntity.Id) ||
                     (m.SenderId == friendEntity.Id && m.ReceiverId == currentUserEntity.Id)) &&
                    m.Id < oldestMessageId)
                .OrderByDescending(m => m.Timestamp)
                .Take(20) // Tải thêm 20 tin nhắn cũ
                .Select(m => new
                {
                    m.Id,
                    m.Content,
                    m.MessageType,
                    m.FileUrl,
                    m.IsPinned,
                    m.Timestamp,
                    SenderUsername = m.Sender.Username,
                    ReceiverUsername = m.Receiver.Username
                })
                .ToListAsync();

            Console.WriteLine($"Loaded {messages.Count} older messages for {currentUser} and {friend}");

            await Clients.Caller.SendAsync("ReceiveOlderMessages", messages.OrderBy(m => m.Timestamp).ToList());
        }
    }
}