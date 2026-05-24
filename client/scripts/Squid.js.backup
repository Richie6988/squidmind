class Squid {
  constructor(agentData, canvas) {
    this.id = agentData.id;
    this.name = agentData.name;
    this.type = agentData.type;
    this.status = agentData.status;
    this.current_thought = agentData.current_thought;
    this.group_id = agentData.group_id;
    this.color = agentData.visual?.color || '#06FFA5';
    this.size = agentData.visual?.size === 'large' ? 48 : 32;
    
    // Position
    this.x = Math.random() * (canvas.width - this.size);
    this.y = Math.random() * (canvas.height - this.size);
    
    // Movement
    this.vx = (Math.random() - 0.5) * 2;
    this.vy = (Math.random() - 0.5) * 2;
    this.targetX = this.x;
    this.targetY = this.y;
    
    // Animation
    this.frame = 0;
    this.frameTimer = 0;
    this.frameDelay = 100; // ms
    
    // States
    this.isHovered = false;
    this.isSelected = false;
    
    // Bounds
    this.canvas = canvas;
  }

  update(deltaTime) {
    // Smooth movement towards target
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > 1) {
      this.x += dx * 0.02;
      this.y += dy * 0.02;
    } else {
      // Pick new random target
      this.targetX = Math.random() * (this.canvas.width - this.size);
      this.targetY = Math.random() * (this.canvas.height - this.size);
    }
    
    // Keep in bounds
    this.x = Math.max(0, Math.min(this.canvas.width - this.size, this.x));
    this.y = Math.max(0, Math.min(this.canvas.height - this.size, this.y));
    
    // Update animation frame
    this.frameTimer += deltaTime;
    if (this.frameTimer > this.frameDelay) {
      this.frame = (this.frame + 1) % 4;
      this.frameTimer = 0;
    }
  }

  draw(ctx) {
    ctx.save();
    
    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(
      this.x + this.size / 2,
      this.y + this.size + 5,
      this.size * 0.4,
      this.size * 0.2,
      0, 0, Math.PI * 2
    );
    ctx.fill();
    
    // Glow effect based on status
    if (this.status === 'working') {
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 20;
    } else if (this.status === 'thinking') {
      ctx.shadowColor = '#FFD60A';
      ctx.shadowBlur = 15;
    } else if (this.status === 'error') {
      ctx.shadowColor = '#E63946';
      ctx.shadowBlur = 25;
    }
    
    // Sleeping: dimmed and slow animation
    if (this.status === 'sleeping') {
      ctx.globalAlpha = 0.5;
    }
    
    // Squid body (simplified pixel art)
    this.drawSquidBody(ctx);
    
    // Reset alpha
    ctx.globalAlpha = 1.0;
    
    // Status-specific effects
    if (this.status === 'sleeping') {
      this.drawSleepingIndicator(ctx);
    } else if (this.status === 'thinking') {
      this.drawThinkingIndicator(ctx);
    }
    
    // Hover/Select outline
    if (this.isHovered || this.isSelected) {
      ctx.strokeStyle = this.isSelected ? '#FFD60A' : '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.strokeRect(this.x - 4, this.y - 4, this.size + 8, this.size + 8);
    }
    
    // Name tag
    if (this.isHovered) {
      this.drawNameTag(ctx);
    }
    
    // Status indicator
    if (this.status === 'working') {
      this.drawWorkingIndicator(ctx);
    }
    
    ctx.restore();
  }

  drawSleepingIndicator(ctx) {
    // Zzz animation
    ctx.font = '12px "Press Start 2P"';
    ctx.fillStyle = '#A8DADC';
    
    const time = Date.now() / 500;
    const offset1 = Math.sin(time) * 3;
    const offset2 = Math.sin(time + 0.5) * 3;
    const offset3 = Math.sin(time + 1) * 3;
    
    ctx.fillText('z', this.x + this.size + 5, this.y + offset1);
    ctx.fillText('z', this.x + this.size + 15, this.y - 5 + offset2);
    ctx.fillText('Z', this.x + this.size + 25, this.y - 10 + offset3);
  }

  drawThinkingIndicator(ctx) {
    // Thought bubbles
    const time = Date.now() / 200;
    
    for (let i = 0; i < 3; i++) {
      const angle = (i * Math.PI * 2 / 3) + time;
      const radius = 15;
      const x = this.x + this.size / 2 + Math.cos(angle) * radius;
      const y = this.y + Math.sin(angle) * radius;
      const size = 3 + Math.sin(time + i) * 1;
      
      ctx.fillStyle = '#FFD60A';
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }
  }

  drawSquidBody(ctx) {
    // Main body
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.ellipse(
      this.x + this.size / 2,
      this.y + this.size / 3,
      this.size * 0.35,
      this.size * 0.4,
      0, 0, Math.PI * 2
    );
    ctx.fill();
    
    // Eyes (animated blink)
    const eyeSize = this.size * 0.12;
    const eyeY = this.y + this.size / 3;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(this.x + this.size * 0.35, eyeY, eyeSize, 0, Math.PI * 2);
    ctx.arc(this.x + this.size * 0.65, eyeY, eyeSize, 0, Math.PI * 2);
    ctx.fill();
    
    // Pupils
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(this.x + this.size * 0.35, eyeY, eyeSize * 0.5, 0, Math.PI * 2);
    ctx.arc(this.x + this.size * 0.65, eyeY, eyeSize * 0.5, 0, Math.PI * 2);
    ctx.fill();
    
    // Tentacles (animated wave)
    const tentacleCount = 8;
    const tentacleLength = this.size * 0.6;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 3;
    
    for (let i = 0; i < tentacleCount; i++) {
      const angle = (Math.PI / tentacleCount) * i + Math.PI * 0.7;
      const wave = Math.sin(Date.now() / 200 + i) * 5;
      
      ctx.beginPath();
      ctx.moveTo(
        this.x + this.size / 2,
        this.y + this.size * 0.6
      );
      ctx.quadraticCurveTo(
        this.x + this.size / 2 + Math.cos(angle) * (tentacleLength / 2) + wave,
        this.y + this.size * 0.8 + wave,
        this.x + this.size / 2 + Math.cos(angle) * tentacleLength,
        this.y + this.size + Math.sin(angle) * tentacleLength
      );
      ctx.stroke();
    }
  }

  drawNameTag(ctx) {
    ctx.font = '10px "Press Start 2P"';
    const nameWidth = ctx.measureText(this.name).width;
    
    // Status indicator text
    let statusText = '';
    let statusColor = '#FFFFFF';
    
    if (this.current_thought) {
      statusText = this.current_thought;
      statusColor = '#FFD60A';
    } else if (this.status === 'sleeping') {
      statusText = 'Zzz...';
      statusColor = '#A8DADC';
    } else if (this.status === 'working') {
      statusText = 'Working...';
      statusColor = '#06FFA5';
    }
    
    const maxTextWidth = Math.max(nameWidth, ctx.measureText(statusText).width);
    const padding = 8;
    const lineHeight = 16;
    const totalHeight = statusText ? 48 : 24;
    
    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.fillRect(
      this.x + this.size / 2 - maxTextWidth / 2 - padding,
      this.y - totalHeight - 10,
      maxTextWidth + padding * 2,
      totalHeight
    );
    
    // Border
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(
      this.x + this.size / 2 - maxTextWidth / 2 - padding,
      this.y - totalHeight - 10,
      maxTextWidth + padding * 2,
      totalHeight
    );
    
    // Name
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(
      this.name,
      this.x + this.size / 2 - nameWidth / 2,
      this.y - totalHeight + 4
    );
    
    // Thinking/Status
    if (statusText) {
      ctx.font = '8px "Press Start 2P"';
      const statusWidth = ctx.measureText(statusText).width;
      ctx.fillStyle = statusColor;
      
      // Wrap text if too long
      const maxWidth = 200;
      if (statusWidth > maxWidth) {
        const words = statusText.split(' ');
        let line = '';
        let y = this.y - totalHeight + 20;
        
        for (const word of words) {
          const testLine = line + word + ' ';
          const testWidth = ctx.measureText(testLine).width;
          if (testWidth > maxWidth && line !== '') {
            ctx.fillText(line, this.x + this.size / 2 - ctx.measureText(line).width / 2, y);
            line = word + ' ';
            y += lineHeight;
          } else {
            line = testLine;
          }
        }
        ctx.fillText(line, this.x + this.size / 2 - ctx.measureText(line).width / 2, y);
      } else {
        ctx.fillText(
          statusText,
          this.x + this.size / 2 - statusWidth / 2,
          this.y - totalHeight + 28
        );
      }
    }
  }

  drawWorkingIndicator(ctx) {
    const pulseSize = 5 + Math.sin(Date.now() / 200) * 2;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(
      this.x + this.size - 8,
      this.y + 8,
      pulseSize,
      0, Math.PI * 2
    );
    ctx.fill();
  }

  containsPoint(x, y) {
    return x >= this.x && x <= this.x + this.size &&
           y >= this.y && y <= this.y + this.size;
  }

  updateStatus(status) {
    this.status = status;
  }
}
