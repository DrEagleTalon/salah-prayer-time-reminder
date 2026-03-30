package audio

import (
	"sync"

	"github.com/ebitengine/oto/v3"
)

// AudioFormatInfo describes the WAV format required by the audio context.
type AudioFormatInfo struct {
	SampleRate int `json:"sampleRate"`
	Channels   int `json:"channels"`
}

// Service manages adhan audio playback
type Service struct {
	ctx          *oto.Context
	player       *oto.Player
	mu           sync.Mutex
	ready        chan struct{}
	initErr      error
	sampleRate   int
	channelCount int
}
