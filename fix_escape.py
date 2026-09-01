#!/usr/bin/env python3
import re

with open("/data/data/com.termux/files/home/TurboReminderBot/index.js", "r") as f:
    content = f.read()

# Replace the buggy escapeMarkdownV2 function with proper MarkdownV2 escaping
old_pattern = r"""const escapeMarkdownV2 = \(str\) =>
  String\(str \|\| ""\)
    .replace\(/\[_\*\[\]\(\)~\\`>\\+\-=\|\{\{!}}\.\\\]/g, "\\\\$&"\)
    .replace\(/>/g, ">";\)"""

new_pattern = r"""const escapeMarkdownV2 = (str) =>
  String(str || "")
    .replace(/[_\*\[\]\(\)~\`>\+\-=\|{\}\!\\\\]/g, "\\$&");"""

# Try a simpler approach - just replace the specific lines
lines = content.split("\n")
new_lines = []
i = 0
while i < len(lines):
    if i >= 36 and i <= 40:  # lines 37-41 (0-indexed 36-40)
        if i == 36:
            # Line 37: function definition - keep as is
            new_lines.append(lines[i])
        elif i == 37:
            # Line 38: String(str || "") - keep as is
            new_lines.append(lines[i])
        elif i == 38:
            # Line 39: .replace(...) - replace with proper MarkdownV2 regex
            # Old: .replace(/[_\*\[\]\(\)~\`>\+\-=\|{{\!}}\\.]/g, "\\$&")
            # New: .replace(/[_\*\[\]\(\)~\`>\+\-=\|{\}\!\\\\]/g, "\\$&");
            new_lines.append(
                '    .replace(/[_\*\[\]\\\\(\\)~\\`>\\+\\-=\|{\}\!\\\\\\\\]/g, "\\\\$&");'
            )
        elif i == 39:
            # Line 40: .replace(/>/g, ">"); - REMOVE THIS LINE (don't include)
            # Skip this line
            pass
        elif i == 40:
            # Line 41: empty line after - keep as is (but we removed line 40, so this adjusts)
            # Actually, let's just handle the blank line
            if i + 1 < len(lines) and lines[i + 1].strip() == "" and i == 39:
                # Skip, the blank line will be handled
                pass
            else:
                new_lines.append(lines[i])
    else:
        new_lines.append(lines[i])
    i += 1

# Join back
content = "\n".join(new_lines)

# Also need to make sure the function is only the single .replace line, not double
# Let me check and fix
with open("/data/data/com.termux/files/home/TurboReminderBot/index.js", "w") as f:
    f.write(content)

print("Done fixing escapeMarkdownV2")
