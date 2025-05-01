using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HermesChatApp.Migrations
{
    /// <inheritdoc />
    public partial class AddIsSeenToMessage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsSeen",
                table: "Messages",
                type: "bit",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsSeen",
                table: "Messages");
        }
    }
}
