using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HermesChatApp.Migrations
{
    /// <inheritdoc />
    public partial class AddFileSizeToMessage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "FileSize",
                table: "Messages",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FileSize",
                table: "Messages");
        }
    }
}
