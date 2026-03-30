package audio

import (
	"bytes"
	_ "embed"
	"encoding/binary"
	"fmt"
	"io"
	"os"

	"github.com/ebitengine/oto/v3"
	"github.com/youpy/go-wav"
)

const (
	pcm16Min = -32768
	pcm16Max = 32767
)

//go:embed adhan.wav
var adhanNormalData []byte

//go:embed adhan_fajr.wav
var adhanFajrData []byte

// NewService creates a new Audio service and initializes the audio context
func NewService() *Service {
	svc := &Service{ready: make(chan struct{})}
	go svc.init()
	return svc
}

func (svc *Service) init() {
	_, sampleRate, channels, err := parseWav(adhanNormalData)
	if err != nil {
		svc.initErr = err
		log.Error("audio context init failed", "error", err)
		close(svc.ready)
		return
	}
	ctx, readyChan, err := oto.NewContext(&oto.NewContextOptions{
		SampleRate:   sampleRate,
		ChannelCount: channels,
		Format:       oto.FormatSignedInt16LE,
	})
	if err != nil {
		svc.initErr = err
		log.Error("audio context init failed", "error", err)
		close(svc.ready)
		return
	}
	<-readyChan
	svc.ctx = ctx
	svc.sampleRate = sampleRate
	svc.channelCount = channels
	close(svc.ready)
}

// waitReady waits until the audio context is ready
func (svc *Service) waitReady() bool {
	<-svc.ready
	return svc.ctx != nil
}

// Play plays the adhan audio. Pass isFajr=true to play the Fajr adhan.
// customPath is the path to a custom WAV file; if empty the built-in audio is used.
// volume is in range 0.0 to 1.0.
func (svc *Service) Play(customPath string, isFajr bool, volume float64) error {
	if !svc.waitReady() {
		if svc.initErr != nil {
			return fmt.Errorf("audio context failed: %w", svc.initErr)
		}
		return fmt.Errorf("audio context not ready")
	}

	svc.mu.Lock()
	defer svc.mu.Unlock()

	// Stop any existing playback
	svc.stopLocked()

	data, err := svc.loadAudioData(customPath, isFajr)
	if err != nil {
		return err
	}

	pcm, sampleRate, channels, err := parseWav(data)
	if err != nil {
		return err
	}
	if svc.sampleRate != 0 && sampleRate != svc.sampleRate {
		return fmt.Errorf("wav sample rate mismatch: expected %d, got %d", svc.sampleRate, sampleRate)
	}
	if svc.channelCount != 0 && channels != svc.channelCount {
		return fmt.Errorf("wav channel count mismatch: expected %d, got %d", svc.channelCount, channels)
	}

	player := svc.ctx.NewPlayer(bytes.NewReader(pcm))
	player.SetVolume(clamp(volume, 0, 1))
	player.Play()
	svc.player = player
	log.Info("adhan play", "fajr", isFajr, "customPath", customPath, "volume", volume)
	return nil
}

// loadAudioData returns the WAV bytes for the given adhan type.
// If customPath is non-empty it reads from disk; on failure it falls back to the built-in audio.
func (svc *Service) loadAudioData(customPath string, isFajr bool) ([]byte, error) {
	if customPath != "" {
		data, err := os.ReadFile(customPath)
		if err != nil {
			log.Warn("custom adhan file unreadable, falling back to built-in", "path", customPath, "error", err)
		} else {
			return data, nil
		}
	}
	if isFajr {
		return adhanFajrData, nil
	}
	return adhanNormalData, nil
}

// ValidateAdhanFile checks that the WAV file at path is compatible with the audio context.
// It returns a descriptive error (including an FFMPEG conversion hint) if the file is invalid.
func (svc *Service) ValidateAdhanFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("cannot read file: %w", err)
	}
	_, fileSampleRate, fileChannels, err := parseWav(data)
	if err != nil {
		return fmt.Errorf("invalid WAV file: %w", err)
	}

	// Determine required format from the built-in reference file.
	_, refSampleRate, refChannels, err := parseWav(adhanNormalData)
	if err != nil {
		// Should never happen with a valid embedded file.
		return nil
	}
	
	if fileSampleRate != refSampleRate || fileChannels != refChannels {
		return fmt.Errorf(
			"incompatible format: file is %d Hz / %d ch, but app requires %d Hz / %d ch — "+
				"convert with: ffmpeg -i \"%s\" -ar %d -ac %d -acodec pcm_s16le output.wav",
			fileSampleRate, fileChannels, refSampleRate, refChannels,
			path, refSampleRate, refChannels,
		)
	}
	return nil
}

// GetAudioFormat returns the sample rate and channel count required by the audio context,
// derived from the built-in adhan file.
func (svc *Service) GetAudioFormat() AudioFormatInfo {
	_, sampleRate, channels, _ := parseWav(adhanNormalData)
	return AudioFormatInfo{SampleRate: sampleRate, Channels: channels}
}

func parseWav(data []byte) (pcm []byte, sampleRate int, channels int, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("wav: decode panic: %v", r)
		}
	}()
	reader := wav.NewReader(bytes.NewReader(data))
	format, err := reader.Format()
	if err != nil {
		return nil, 0, 0, err
	}
	if format == nil {
		return nil, 0, 0, fmt.Errorf("wav: missing format")
	}
	if format.BitsPerSample != 16 {
		return nil, 0, 0, fmt.Errorf("wav: unsupported bits per sample %d", format.BitsPerSample)
	}
	channels = int(format.NumChannels)
	sampleRate = int(format.SampleRate)
	if channels != 1 && channels != 2 {
		return nil, 0, 0, fmt.Errorf("wav: unsupported channels %d", channels)
	}

	var buf bytes.Buffer
	for {
		samples, err := reader.ReadSamples()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, 0, 0, err
		}
		for _, sample := range samples {
			for ch := 0; ch < channels; ch++ {
				v := reader.IntValue(sample, uint(ch))
				if v > pcm16Max {
					v = pcm16Max
				} else if v < pcm16Min {
					v = pcm16Min
				}
				_ = binary.Write(&buf, binary.LittleEndian, int16(v))
			}
		}
	}

	return buf.Bytes(), sampleRate, channels, nil
}

// Stop stops any currently playing adhan
func (svc *Service) Stop() {
	svc.mu.Lock()
	defer svc.mu.Unlock()
	svc.stopLocked()
}

func (svc *Service) stopLocked() {
	if svc.player != nil {
		log.Info("adhan stop")
		svc.player.Pause()
		_, _ = svc.player.Seek(0, io.SeekStart)
		svc.player = nil
	}
}

// IsPlaying returns whether the adhan is currently playing
func (svc *Service) IsPlaying() bool {
	svc.mu.Lock()
	defer svc.mu.Unlock()
	return svc.player != nil && svc.player.IsPlaying()
}

func clamp(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}
