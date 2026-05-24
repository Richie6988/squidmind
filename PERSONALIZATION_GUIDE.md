# 🎮 SquidMind - Pokemon-Style Personalization Guide

## Overview

SquidMind now features **Pokemon-style** customization and interactions! Each squid is unique, has personality, can be dressed up, and responds to your care.

---

## 🦑 Squid Customization

### Appearance

```javascript
{
  "appearance": {
    "body_color": "#FF6B9D",      // Main squid color (hex)
    "accent_color": "#FFE66D",    // Spots/patterns color
    "eye_style": "round",         // round, cute, sleepy, sharp
    "tentacle_style": "wavy",     // wavy, straight, curly
    "size": "medium",             // small, medium, large
    "glow_intensity": 0.5         // 0-1 (glow brightness)
  }
}
```

**Examples:**

**Cute Pink Squid:**
```json
{
  "body_color": "#FFB3D9",
  "accent_color": "#FFFF99",
  "eye_style": "cute",
  "size": "small",
  "glow_intensity": 0.8
}
```

**Cool Blue Squid:**
```json
{
  "body_color": "#4A90E2",
  "accent_color": "#50E3C2",
  "eye_style": "sharp",
  "size": "large",
  "glow_intensity": 0.3
}
```

---

### Outfits & Accessories

```javascript
{
  "outfit": {
    "hat": "wizard_hat",          // null, wizard_hat, crown, headphones
    "accessory": "glasses",       // null, glasses, bowtie, scarf
    "tool": "wand",               // null, wand, laptop, magnifying_glass
    "background_effect": "sparkles" // null, sparkles, flames, code_rain
  }
}
```

**Available Outfits:**

**Hats:**
- `wizard_hat` - Purple pointed hat with stars (for magic squids)
- `crown` - Gold crown (for elite squids)
- `headphones` - Gaming headset (for tech squids)

**Accessories:**
- `glasses` - Nerd glasses (for smart squids)
- `bowtie` - Red bowtie (for formal squids)

**Tools:**
- `wand` - Magic wand with sparkles
- `laptop` - Mini laptop with code on screen

**Background Effects:**
- `sparkles` - Golden particles orbiting
- `flames` - Fire effect below squid
- `code_rain` - Matrix-style falling code

**Example Combinations:**

**Wizard Squid:**
```json
{
  "hat": "wizard_hat",
  "tool": "wand",
  "background_effect": "sparkles"
}
```

**Tech Bro Squid:**
```json
{
  "hat": "headphones",
  "accessory": "glasses",
  "tool": "laptop",
  "background_effect": "code_rain"
}
```

**Elite Squid:**
```json
{
  "hat": "crown",
  "accessory": "bowtie",
  "background_effect": "flames"
}
```

---

### Personality

```javascript
{
  "personality": {
    "mood": "happy",              // happy, focused, tired, excited, grumpy
    "energy": 100,                // 0-100 (decreases with use)
    "affection": 50,              // 0-100 (increases with interaction)
    "animation_style": "bouncy"   // bouncy, smooth, energetic, calm
  }
}
```

**Animation Styles:**
- `bouncy` - Big bouncy movements (Pokemon style)
- `smooth` - Gentle floating
- `energetic` - Fast, excited movements
- `calm` - Slow, relaxed movements

---

### Stats & Level System

```javascript
{
  "stats": {
    "level": 1,                   // 1-100
    "experience": 0,              // XP points
    "total_executions": 0,        // Tasks completed
    "success_count": 0,           // Successful tasks
    "average_quality": 0,         // 0-10 user rating
    "speed_rating": 0,            // Tokens/second
    "specialization_score": 0,    // How good at specialty
    "user_ratings": [             // User reviews
      {
        "user_id": "user_123",
        "rating": 9,
        "comment": "Amazing code reviewer!"
      }
    ],
    "badges": []                  // Earned achievements
  }
}
```

**Leveling Up:**
- Every task completed = +10 XP
- Every 100 XP = +1 Level
- Higher level = better at tasks
- Unlock new outfits at certain levels

**Badges (Auto-earned):**
- `first_execution` - Completed first task
- `speed_demon` - 100 tokens/sec
- `perfectionist` - 10 tasks with 10/10 rating
- `marathon_runner` - 1000 total executions
- `specialist` - Specialization score > 90

---

## 🎯 Marketplace System

### Selling Your Best Squids

```javascript
{
  "marketplace": {
    "is_for_sale": true,
    "price": 100,                 // $100 USD
    "owner_id": "user_richard",
    "clone_count": 15,            // Sold 15 times
    "original_creator": "user_richard",
    "royalty_percentage": 10      // 10% to creator on resale
  }
}
```

**How It Works:**

1. **Train Your Squid**
   - Complete many tasks
   - Get high ratings
   - Level up to 50+
   - Earn rare badges

2. **Put Up For Sale**
   ```javascript
   PUT /api/agents/:id
   {
     "marketplace": {
       "is_for_sale": true,
       "price": 200
     }
   }
   ```

3. **Users Buy Clones**
   - They get exact copy (brain + stats)
   - Original stays with you
   - You get royalties on resales

4. **Earn Passive Income**
   - Every sale = $200
   - Every resale = 10% royalty
   - Popular squids = $$$

---

## 🎮 Interactions

### Click to Play

**Click on squid:**
- Squid jumps in the air
- Affection +5
- Plays happy animation

**Double-click rapidly:**
- Squid does backflip (coming soon)

### Pet for Hearts

**Hold click on squid for 1 second:**
- Heart particles appear
- Affection +10
- Mood improves
- Squid becomes happier

**High Affection Benefits:**
- Better task performance
- Faster execution
- More creative responses
- Unlocks special animations

---

## 🎨 Creating Your Perfect Squid

### Example 1: Elite Code Reviewer

```javascript
POST /api/agents
{
  "name": "CodeMaster Pro",
  "nickname": "CodeMaster",
  "brain_id": "brain_code_reviewer",
  
  "appearance": {
    "body_color": "#2C3E50",
    "accent_color": "#3498DB",
    "eye_style": "sharp",
    "size": "large",
    "glow_intensity": 0.7
  },
  
  "outfit": {
    "hat": "crown",
    "accessory": "glasses",
    "tool": "laptop",
    "background_effect": "code_rain"
  },
  
  "personality": {
    "animation_style": "calm"
  }
}
```

### Example 2: Cute Data Wizard

```javascript
POST /api/agents
{
  "name": "Data Pixie",
  "nickname": "Pixie ✨",
  "brain_id": "brain_data_analyst",
  
  "appearance": {
    "body_color": "#DA70D6",
    "accent_color": "#FFD700",
    "eye_style": "cute",
    "size": "small",
    "glow_intensity": 1.0
  },
  
  "outfit": {
    "hat": "wizard_hat",
    "tool": "wand",
    "background_effect": "sparkles"
  },
  
  "personality": {
    "animation_style": "bouncy"
  }
}
```

### Example 3: Speed Demon

```javascript
POST /api/agents
{
  "name": "Lightning Bolt",
  "nickname": "⚡ Bolt",
  "brain_id": "brain_code_reviewer",
  
  "appearance": {
    "body_color": "#FFD700",
    "accent_color": "#FF6347",
    "eye_style": "round",
    "size": "medium",
    "glow_intensity": 0.9
  },
  
  "outfit": {
    "hat": "headphones",
    "background_effect": "flames"
  },
  
  "personality": {
    "animation_style": "energetic"
  }
}
```

---

## 📊 Rating System

### Rate Agent Performance

```javascript
POST /api/agents/:id/rate
{
  "rating": 9,
  "comment": "Excellent code review! Found 3 critical bugs."
}
```

**Rating Scale:**
- 10 = Perfect, exceptional work
- 8-9 = Very good, minor improvements
- 6-7 = Good, some issues
- 4-5 = Okay, needs work
- 1-3 = Poor, major problems

**High Ratings:**
- Increase agent's average_quality
- Boost specialization_score
- Earn badges
- Increase marketplace value

---

## 🏆 Achievement System

### Auto-Earned Badges

Badges are earned automatically based on performance:

**Speed Badges:**
- `quick_starter` - First execution in <5 seconds
- `speed_demon` - 100+ tokens/sec
- `lightning_fast` - 200+ tokens/sec

**Quality Badges:**
- `perfectionist` - 10 tasks rated 10/10
- `reliable` - 100 tasks with 8+ average
- `expert` - 500 tasks with 9+ average

**Volume Badges:**
- `first_steps` - 1 execution
- `getting_started` - 10 executions
- `experienced` - 100 executions
- `veteran` - 500 executions
- `master` - 1000 executions

**Specialty Badges:**
- `code_guardian` - 100 code reviews
- `data_wizard` - 100 data analyses
- `bug_hunter` - Found 50+ bugs

---

## 🎪 Mini-Games (Coming Soon)

### Squid Training

**Speed Challenge:**
- Complete task as fast as possible
- Earn speed badges
- Improve speed_rating stat

**Accuracy Challenge:**
- Complete task perfectly
- Earn quality badges
- Improve specialization_score

**Endurance Challenge:**
- Complete 100 tasks in a row
- Earn marathon badges
- Boost energy permanently

---

## 💡 Tips & Tricks

### Maximizing Performance

**1. Keep Affection High:**
- Pet your squid daily
- High affection = better performance
- Aim for 80+ affection

**2. Match Personality to Task:**
- `energetic` for quick tasks
- `calm` for complex tasks
- `bouncy` for creative tasks

**3. Level Up Smart:**
- Focus on one specialty
- Complete similar tasks
- Build specialization_score

**4. Unlock Rare Outfits:**
- Level 25: Crown unlocked
- Level 50: All outfits unlocked
- Level 100: Legendary effects

### Building Marketplace Value

**1. Perfect Your Brain:**
- Fine-tune system prompts
- Add instruction templates
- Optimize temperature

**2. Get High Ratings:**
- Deliver quality work
- Be consistent
- Respond to feedback

**3. Build Track Record:**
- 500+ executions
- 9+ average rating
- Multiple badges

**4. Price Right:**
- Research similar squids
- Start at $50-100
- Increase with track record

---

## 🔮 Roadmap

**v2.1 - More Interactions:**
- Mini-games
- Squid-to-squid interactions
- Trading system
- Battle mode (performance competition)

**v2.2 - More Customization:**
- Custom animations
- Voice lines
- Emotes
- Squid families

**v2.3 - Marketplace:**
- Public marketplace
- Squid NFTs (optional)
- Rental system
- Breeding system (combine 2 brains)

---

**Your squids are now Pokemon-style companions!** 🦑✨

Train them, customize them, interact with them, and build the best AI team! 🎮
