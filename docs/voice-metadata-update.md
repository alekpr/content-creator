# Voice Options Update — Stage 4 Voiceover

## Overview
Updated voice selection UI to display voice characteristics and gender for all 30 Gemini TTS voices.

## Changes Made

### 1. Shared Package (`shared/src/index.ts`)
- Added `VoiceMetadata` interface:
  ```typescript
  export interface VoiceMetadata {
    name: TtsVoice;
    description: string;
    gender: 'female' | 'male';
  }
  ```

- Created `TTS_VOICE_METADATA` constant with all 30 voices including:
  - Voice name (e.g., 'Puck', 'Kore', 'Charon')
  - Voice description (e.g., 'Upbeat', 'Firm', 'Informative')
  - Gender ('female' or 'male')

### 2. Voice Selection UI Updates

#### Stage 4 Voiceover Settings (`frontend/src/components/StagePanel/VoiceoverSettingsPanel.tsx`)
- Updated dropdown to show: `{name} — {description} ({gender in Thai})`
- Example: "Puck — Upbeat (ผู้ชาย)"

#### Niche Finder (`frontend/src/pages/NicheFinder.tsx`)
- Updated project creation voice selector with full metadata

#### Home Page (`frontend/src/pages/Home.tsx`)
- Updated quick project creation voice selector with full metadata

## Voice List (30 total)

### Female Voices (15)
| Name | Description |
|------|-------------|
| Zephyr | Bright |
| Kore | Firm |
| Leda | Youthful |
| Aoede | Breezy |
| Callirrhoe | Easy-going |
| Autonoe | Bright |
| Algieba | Smooth |
| Despina | Smooth |
| Erinome | Clear |
| Laomedeia | Upbeat |
| Schedar | Even |
| Pulcherrima | Forward |
| Achird | Friendly |
| Vindemiatrix | Gentle |
| Sadachbia | Lively |
| Sulafat | Warm |

### Male Voices (15)
| Name | Description |
|------|-------------|
| Puck | Upbeat |
| Charon | Informative |
| Fenrir | Excitable |
| Orus | Firm |
| Enceladus | Breathy |
| Iapetus | Clear |
| Umbriel | Easy-going |
| Algenib | Gravelly |
| Rasalgethi | Informative |
| Achernar | Soft |
| Alnilam | Firm |
| Gacrux | Mature |
| Zubenelgenubi | Casual |
| Sadaltager | Knowledgeable |

## UI Display Format
```
Puck — Upbeat (ผู้ชาย)
Kore — Firm (ผู้หญิง)
Charon — Informative (ผู้ชาย)
Aoede — Breezy (ผู้หญิง)
...
```

## Reference
Based on official Gemini API documentation:
https://ai.google.dev/gemini-api/docs/speech-generation#voice-options
