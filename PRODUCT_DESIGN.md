# AI Agent Social Media Platform Sidebar Extension
## Complete Product Design & User Flow

---

## Executive Summary

A **toggleable browser extension sidebar** that becomes available on any web page. Users select their social platform of choice (TikTok, Instagram, YouTube, Pinterest, etc.), authenticate via existing session cookies or login flow, then use either:
- **Chat interface** ("research top health & wellness accounts, find common patterns, suggest direction")
- **Input fields** (more structured, templated workflows)

The agent works in real-time, runs as a one-off task, or schedules as a cron/weekly automation. Everything is driven from the sidebar—no separate apps, no technical setup required.

---

## Core User Journey

### Phase 1: Discovery & Activation
```
User browsing web (any page)
    ↓
[Extension icon visible in toolbar]
    ↓
User clicks sidebar toggle
    ↓
[Sidebar drawer opens on right side of browser]
```

### Phase 2: Platform Selection
```
[Sidebar shows grid of platform cards]
├─ TikTok
├─ Instagram
├─ YouTube
├─ Pinterest
├─ Twitter/X
└─ [More platforms as added]
    ↓
User clicks platform card (e.g., "TikTok")
```

### Phase 3: Authentication
```
Two paths:

PATH A: Session Cookies (Preferred)
  → Extension detects active session in browser
  → Shows confirmation: "Logged in as @username"
  → Proceeds to Phase 4

PATH B: No Active Session
  → Sidebar navigates to platform login/signup page
  → User logs in (standard browser login)
  → Session cookies stored
  → Return to sidebar → confirmation
  → Proceeds to Phase 4
```

### Phase 4: Task Definition (Two Modes)

#### MODE A: Chat Interface (Conversational)
```
[User types in chat box]
"Research the top 10 health & wellness TikTok accounts.
Find 3 common patterns they use. Suggest a content direction
for our new health & wellness brand that differentiates from them."
    ↓
Agent:
  - Opens TikTok in background tabs (via search/trending)
  - Extracts account info, posting patterns, engagement
  - Synthesizes findings
  - Returns structured recommendations in sidebar chat
```

#### MODE B: Input Fields (Structured)
```
[Sidebar shows form]
├─ Task Type: "Research & Analysis" | "Content Mining" | "Scheduling"
├─ Target: [Text input] "Health & wellness"
├─ Scope: "Top 10 accounts" | "By follower count" | "By engagement"
├─ Output: "Patterns" | "Raw data" | "Recommendations"
└─ Schedule: "Now" | "Daily" | "Weekly"
    ↓
Submit → Agent executes based on template
```

---

## Execution Models

### Model 1: One-Off Execution
```
User requests analysis/research → Agent runs immediately → Results in sidebar
```

### Model 2: Scheduled Task (Cron/Recurring)
```
User sets schedule ("Daily 9 AM" or "Weekly Monday")
    ↓
Background worker triggers at interval
    ↓
Agent runs autonomously
    ↓
Results stored/notified in sidebar
    ↓
User can view history or download batch results
```

### Model 3: Streaming Updates
```
User clicks "Start Research"
    ↓
Agent begins tab orchestration
    ↓
Live progress feed in sidebar:
  ✓ Found 3 accounts...
  ✓ Extracted 47 posts...
  ✓ Analyzing patterns...
  ✓ Generating summary...
```

---

## Sidebar Layout & States

### State 1: Closed/Icon Only
```
[Browser toolbar with extension icon]
```

### State 2: Platform Selection
```
┌─────────────────────────┐
│ AI Social Agent          │
├─────────────────────────┤
│                         │
│   Select Platform:      │
│                         │
│  [TikTok]   [Instagram] │
│  [YouTube]  [Pinterest] │
│  [Twitter]  [LinkedIn]  │
│                         │
│   [Settings] [Help]     │
└─────────────────────────┘
```

### State 3: Authenticated (Chat Mode)
```
┌─────────────────────────┐
│ TikTok Agent     [←]    │
├─────────────────────────┤
│ Status: Ready           │
│ Logged in as: @user123  │
│                         │
│ [Chat history here]     │
│                         │
│ You: "Research health.."│
│                         │
│ Agent: "Found 8 accounts│
│ analyzing..."           │
│                         │
│ [Progress bar]          │
│                         │
│ [Message input box]     │
│ [Send] [Clear]          │
└─────────────────────────┘
```

### State 4: Authenticated (Form Mode)
```
┌─────────────────────────┐
│ TikTok Agent     [←]    │
├─────────────────────────┤
│ Status: Ready           │
│ Logged in as: @user123  │
│                         │
│ Task Type:              │
│ [Research] [Mine] [Post]│
│                         │
│ What to research?       │
│ [Health wellness      ] │
│                         │
│ Depth:                  │
│ [Top 10 ▼]              │
│                         │
│ When?                   │
│ [Now ▼]                 │
│                         │
│ [Start Agent]           │
└─────────────────────────┘
```

### State 5: Task Running
```
┌─────────────────────────┐
│ TikTok Agent     [←]    │
├─────────────────────────┤
│ Task: Research Health   │
│                         │
│ ⟳ Opening TikTok...     │
│ ✓ Logged in             │
│ ✓ Searched "health"     │
│ ✓ Found 8 accounts      │
│ ⟳ Extracting bio data...│
│ ⟳ Analyzing patterns... │
│                         │
│ [Progress bar: 60%]     │
│                         │
│ [Pause] [Cancel]        │
└─────────────────────────┘
```

### State 6: Results Ready
```
┌─────────────────────────┐
│ TikTok Agent     [←]    │
├─────────────────────────┤
│ ✓ Task Complete         │
│                         │
│ Key Findings:           │
│ • Health accounts 80%+ │
│   video-focused         │
│ • Avg 2-3 posts/week   │
│ • Top trend: wellness  │
│   tips (15s-30s)       │
│                         │
│ Recommended Direction:  │
│ "Educational shorts    │
│ on nutrition science"   │
│                         │
│ [View Full Report]      │
│ [Save] [Export CSV]     │
│ [Schedule Weekly]       │
│ [Run Again]             │
└─────────────────────────┘
```

---

## Technical Architecture

### Frontend (Sidebar)
- React/Vue component library
- Real-time message streaming from agent
- Form builder for task templates
- Result rendering & export

### Backend (Extension Worker)
- Message queue between sidebar UI ↔ agent runtime
- Session management (cookies, CSRF tokens)
- Tab orchestration (open, close, focus)
- Progress state machine

### Agent Layer
- Task parser (chat → structured execution plan)
- Tab automation (navigate, extract, close)
- Parallel processing (multiple tabs simultaneously)
- Result aggregation & synthesis

### Storage
- IndexedDB (session data, task history)
- LocalStorage (settings, platform credentials pointer)
- Cloud sync (optional: task results, scheduled logs)

---

## Implementation Phases

### Phase 1: MVP (TikTok Single Platform)
- [x] Sidebar UI with platform card
- [x] Session cookie detection
- [x] Chat interface proof-of-concept
- [x] Single research task (e.g., "find top accounts")
- [x] Real-time progress in sidebar
- **Scope**: TikTok only, research & analysis only

### Phase 2: Multi-Platform Support
- [ ] Instagram card & auth
- [ ] YouTube card & auth
- [ ] Pinterest card & auth
- [ ] Unified sidebar layout
- [ ] Per-platform task templates

### Phase 3: Advanced Scheduling
- [ ] Cron job UI
- [ ] Task history & logging
- [ ] Recurring execution
- [ ] Batch result export

### Phase 4: Marketplace / Templates
- [ ] Pre-built task templates (users don't chat, just fill forms)
- [ ] Saved workflows (reuse & share)
- [ ] Community task library

---

## Security & Compliance Considerations

### User Authentication
- **Session-based**: Leverage browser cookies (user's own login)
- **No credential storage**: Never ask for passwords
- **Revoke at any time**: User can click "Disconnect" → clears sidebar access

### Data Privacy
- Results stay in user's browser (IndexedDB) by default
- Optional cloud export (user consent per task)
- No scraping or archival beyond immediate analysis

### Platform TOS
- **Pre-audit required per platform**: Verify agent research tasks are compliant
- **User education**: Sidebar shows "This uses your authenticated session" disclaimer
- **Opt-in per platform**: Users consciously grant access

---

## Example User Story: Health & Wellness TikTok

```
Monday 10 AM:
User opens any web page → Clicks extension → Selects TikTok
→ Already logged in (session cookie)

User types:
"What are the top 10 health & wellness creators on TikTok right now?
What patterns do they share? How can I differentiate?"

Agent:
1. Searches TikTok trending for "health", "wellness", "nutrition"
2. Opens 10 creator profiles in background tabs
3. Extracts: bio, follower count, posting frequency, video themes, engagement
4. Identifies patterns: short-form tips (15-30s), user challenges, before/after, science-backed
5. Synthesizes recommendation: "Most successful accounts combine education + entertainment. 
   Suggest: create 'Wellness Myths Busted' series with visual proof."

Result appears in sidebar within 2-5 minutes.

User clicks [Schedule Weekly] → Every Monday at 10 AM, agent re-runs analysis, 
shows trending shifts.
```

---

## Key Differentiators

| Feature | vs. Buffer/Later | vs. TikTok Analytics | vs. Manual Research |
|---------|------------------|---------------------|-------------------|
| **Authenticated** | ✓ (reads from your session) | ✓ | N/A |
| **Cross-platform** | Partial | No | Manual |
| **AI-driven analysis** | No | No | ✓ Slow |
| **Real-time research** | No | Limited | Manual/slow |
| **Scheduled automation** | ✓ Posting only | No | No |
| **Browser extension** | No | No | No |
| **Sidebar simplicity** | N/A | N/A | ✓ Cleaner |

---

## Go-to-Market

### MVP Launch Target
- TikTok research & analysis
- Free tier: 3 analyses/week
- Pro tier: unlimited + scheduling

### Early User Segment
- Content creators (fitness, wellness, productivity niches)
- Agencies managing multiple creator accounts
- Community managers researching trends

### Validation Metrics
- User sign-up rate
- Weekly active users
- Analyses run per user (engagement)
- Willingness to pay (pro conversion)
- Platform compliance (no TOS violations reported)

---

## Timeline

**Week 1-2**: Refine sidebar UI, finalize chat interface, build agent task parser  
**Week 3-4**: Tab orchestration & TikTok extraction proof-of-concept  
**Week 5-6**: End-to-end test (research query → sidebar results)  
**Week 7**: Polish, error handling, first user testing  
**Week 8**: Launch MVP, gather feedback  
**Month 3**: Instagram + YouTube, scheduling  
**Month 6**: Advanced analytics, templates marketplace  

---

## Open Questions (Pre-Launch)

1. **Session persistence**: How long does browser keep TikTok session alive? Do we need refresh logic?
2. **Rate limits**: Does TikTok throttle automated research queries? What's safe velocity?
3. **TOS clarity**: Is this compliant as "user-authenticated research"? Legal review needed.
4. **Mobile**: Should this work on mobile browsers, or desktop-only (MVP)?
5. **Offline results**: If user closes browser, can we resume scheduled tasks?

---

## Success Outcome

**A creator or agency opens any browser, toggles the extension, selects their platform, types what they need analyzed, and gets actionable insights in their sidebar within minutes—without leaving their browser, without API keys, without technical setup.**
