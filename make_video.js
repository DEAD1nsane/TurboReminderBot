const { execSync } = require('child_process');

const script = `ffmpeg -y -f lavfi -i color=c=0x0d1117:s=1280x720:r=30 -t 5 -vf "drawtext=text='@TurbosRbot':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2-30,drawtext=text='Never miss a beat. Shorthand & Recurring Reminders':fontcolor=0x58a6ff:fontsize=22:x=(w-text_w)/2:y=(h-text_h)/2+30" -c:v libx264 -pix_fmt yuv420p bot_promo.mp4`;

try {
	    execSync(script);
	    console.log('Successfully generated bot_promo.mp4!');
} catch (err) {
	    console.error('Error generating video. Make sure ffmpeg and libx264 are installed.', err.message);
}


