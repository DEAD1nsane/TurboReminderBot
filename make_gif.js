const { execSync } = require('child_process');

const script = `ffmpeg -y -i bot_promo.mp4 -vf "fps=15,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" bot_promo.gif`;

try {
    execSync(script);
    console.log('Successfully generated bot_promo.gif!');
} catch (err) {
    console.error('Error generating GIF:', err.message);
}

