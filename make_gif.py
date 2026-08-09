import cv2
import numpy as np

width, height = 640, 360
fps = 20
duration = 3
total_frames = fps * duration

fourcc = cv2.VideoWriter_fourcc(*'mp4v')
out = cv2.VideoWriter('description.mp4', fourcc, fps, (width, height))

for frame in range(total_frames):
    img = np.zeros((height, width, 3), np.uint8)
    
    # Header
    cv2.putText(img, "WHAT CAN THIS BOT DO?", (130, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
    cv2.line(img, (130, 60), (510, 60), (0, 0, 255), 1)
    
    # Section 1
    cv2.putText(img, "Styles", (50, 110), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
    cv2.putText(img, "- Shorthand: 1h30m", (70, 135), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180, 180, 180), 1)
    cv2.putText(img, "- 12h & 24h: 4pm or 16:00", (70, 160), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180, 180, 180), 1)
    
    # Section 2
    cv2.putText(img, "View & Manage", (50, 205), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
    cv2.putText(img, "Type 'view' or @TurbosRbot", (70, 230), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180, 180, 180), 1)
    
    # Animated pulsing text at bottom
    alpha = (np.sin(frame / total_frames * 2 * np.pi) + 1) / 2
    color_val = int(100 + 155 * alpha)
    cv2.putText(img, "Type @TurbosRbot take meds 4pm repeat", (50, 290), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, color_val), 2)

    out.write(img)

out.release()
print("Video generated: description.mp4")
