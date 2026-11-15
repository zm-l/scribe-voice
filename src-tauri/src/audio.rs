use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::{
    io::Cursor,
    sync::{mpsc, Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter};

pub struct CapturedAudio {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub device_name: String,
}
#[derive(Serialize)]
pub struct MicrophoneProbe {
    pub device_name: String,
    pub peak_level: f64,
    pub detected_audio: bool,
}
#[derive(Clone, Serialize)]
struct Level {
    level: f64,
    duration_ms: u64,
}
enum AudioCommand {
    Start(mpsc::Sender<Result<String, String>>),
    Stop(mpsc::Sender<Result<CapturedAudio, String>>),
    Cancel(mpsc::Sender<()>),
}
pub struct AudioService {
    tx: mpsc::Sender<AudioCommand>,
}
struct ActiveCapture {
    _stream: cpal::Stream,
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
    name: String,
    error: Arc<Mutex<Option<String>>>,
    auto_stop_requested: bool,
}
impl AudioService {
    pub fn new(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let mut active: Option<ActiveCapture> = None;
            loop {
                match rx.recv_timeout(Duration::from_millis(70)) {
                    Ok(AudioCommand::Start(reply)) => {
                        if active.is_some() {
                            let _ = reply.send(Err(
                                "Microphone is already in use by a recording or test.".into(),
                            ));
                            continue;
                        }
                        match open_capture() {
                            Ok(capture) => {
                                let name = capture.name.clone();
                                active = Some(capture);
                                let _ = reply.send(Ok(name));
                            }
                            Err(e) => {
                                let _ = reply.send(Err(e));
                            }
                        }
                    }
                    Ok(AudioCommand::Stop(reply)) => {
                        let result = active
                            .take()
                            .ok_or_else(|| "No microphone recording is active.".to_string())
                            .map(|capture| {
                                let ActiveCapture {
                                    _stream,
                                    samples,
                                    sample_rate,
                                    name,
                                    ..
                                } = capture;
                                drop(_stream);
                                let samples = std::mem::take(&mut *samples.lock().unwrap());
                                CapturedAudio {
                                    samples,
                                    sample_rate,
                                    device_name: name,
                                }
                            });
                        let _ = reply.send(result);
                    }
                    Ok(AudioCommand::Cancel(reply)) => {
                        active = None;
                        let _ = reply.send(());
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
                if let Some(capture) = active.as_mut() {
                    let data = capture.samples.lock().unwrap();
                    let duration_ms = (data.len() as u64) * 1000 / (capture.sample_rate as u64);
                    let tail = &data[data
                        .len()
                        .saturating_sub((capture.sample_rate / 10) as usize)..];
                    let level = rms_level(tail);
                    drop(data);
                    let _ = app.emit("voice-level", Level { level, duration_ms });
                    if let Some(error) = capture.error.lock().unwrap().take() {
                        let a = app.clone();
                        tauri::async_runtime::spawn(async move {
                            crate::microphone_failed(a, error).await;
                        });
                    }
                    if duration_ms >= crate::model::MAX_DURATION_MS && !capture.auto_stop_requested
                    {
                        capture.auto_stop_requested = true;
                        let a = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = crate::stop_session(a).await;
                        });
                    }
                }
            }
        });
        Self { tx }
    }
    pub fn start(&self) -> Result<String, String> {
        let (tx, rx) = mpsc::channel();
        self.tx
            .send(AudioCommand::Start(tx))
            .map_err(|_| "Audio worker unavailable".to_string())?;
        rx.recv_timeout(Duration::from_secs(6)).map_err(|_| {
            "Microphone did not respond. Check Windows microphone permissions.".to_string()
        })?
    }
    pub fn stop(&self) -> Result<CapturedAudio, String> {
        let (tx, rx) = mpsc::channel();
        self.tx
            .send(AudioCommand::Stop(tx))
            .map_err(|_| "Audio worker unavailable".to_string())?;
        rx.recv_timeout(Duration::from_secs(6))
            .map_err(|_| "Microphone stop timed out.".to_string())?
    }
    pub fn cancel(&self) {
        let (tx, rx) = mpsc::channel();
        let _ = self.tx.send(AudioCommand::Cancel(tx));
        let _ = rx.recv_timeout(Duration::from_secs(3));
    }
}
fn open_capture() -> Result<ActiveCapture, String> {
    let host = cpal::default_host();
    let device=host.default_input_device().ok_or_else(||"No default microphone found. Connect a microphone and select it in Windows Sound settings.".to_string())?;
    let supported=device.default_input_config().map_err(|e|format!("Cannot access microphone. Enable microphone access for desktop apps in Windows Settings. {e}"))?;
    let name = device
        .name()
        .unwrap_or_else(|_| "Default microphone".into());
    let config: cpal::StreamConfig = supported.clone().into();
    let samples = Arc::new(Mutex::new(Vec::new()));
    let error = Arc::new(Mutex::new(None));
    let channels = config.channels as usize;
    let cap = config.sample_rate.0 as usize * 120;
    let stream=match supported.sample_format() {
        cpal::SampleFormat::F32=>build::<f32>(&device,&config,samples.clone(),error.clone(),channels,cap,|x|x),
        cpal::SampleFormat::I16=>build::<i16>(&device,&config,samples.clone(),error.clone(),channels,cap,|x|x as f32/32768.0),
        cpal::SampleFormat::U16=>build::<u16>(&device,&config,samples.clone(),error.clone(),channels,cap,|x|(x as f32-32768.0)/32768.0),
        f=>return Err(format!("Microphone sample format {f:?} is not supported by this MVP. Select a 16-bit or float microphone device in Windows.")),
    }.map_err(|e|format!("Cannot open microphone. Check privacy settings and whether another app has exclusive access. {e}"))?;
    stream
        .play()
        .map_err(|e| format!("Cannot start microphone: {e}"))?;
    Ok(ActiveCapture {
        _stream: stream,
        samples,
        sample_rate: config.sample_rate.0,
        name,
        error,
        auto_stop_requested: false,
    })
}
fn build<T: cpal::SizedSample + Copy + Send + 'static>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    samples: Arc<Mutex<Vec<f32>>>,
    error: Arc<Mutex<Option<String>>>,
    channels: usize,
    cap: usize,
    convert: fn(T) -> f32,
) -> Result<cpal::Stream, cpal::BuildStreamError> {
    device.build_input_stream(
        config,
        move |data: &[T], _| {
            if let Ok(mut buffer) = samples.lock() {
                for frame in data.chunks_exact(channels) {
                    if buffer.len() >= cap {
                        break;
                    }
                    buffer.push(frame.iter().map(|&x| convert(x)).sum::<f32>() / channels as f32);
                }
            }
        },
        move |e| {
            if let Ok(mut slot) = error.lock() {
                *slot = Some(format!("Microphone disconnected or failed: {e}"));
            }
        },
        None,
    )
}
pub fn rms_level(samples: &[f32]) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    ((samples.iter().map(|&x| (x as f64).powi(2)).sum::<f64>() / samples.len() as f64).sqrt() * 8.0)
        .clamp(0.0, 1.0)
}
pub fn encode_wav(audio: &CapturedAudio) -> Result<Vec<u8>, String> {
    if audio.samples.len() < audio.sample_rate as usize / 5 {
        return Err("Recording was too short. Speak for at least a moment and try again.".into());
    }
    if rms_level(&audio.samples) < 0.001 {
        return Err("No audible input detected. Check your microphone and try again.".into());
    }
    let samples = resample(&audio.samples, audio.sample_rate, 16_000);
    let mut cursor = Cursor::new(Vec::new());
    {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::new(&mut cursor, spec).map_err(|e| e.to_string())?;
        for x in samples {
            writer
                .write_sample((x.clamp(-1.0, 1.0) * 32767.0) as i16)
                .map_err(|e| e.to_string())?;
        }
        writer.finalize().map_err(|e| e.to_string())?;
    }
    Ok(cursor.into_inner())
}
// Linear resampling is sufficient for the MVP. Replace with band-limited resampling for production.
fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to {
        return input.to_vec();
    }
    let len = (input.len() as u64 * to as u64 / from as u64) as usize;
    (0..len)
        .map(|i| {
            let pos = i as f64 * from as f64 / to as f64;
            let left = pos.floor() as usize;
            let right = (left + 1).min(input.len().saturating_sub(1));
            let f = (pos - left as f64) as f32;
            input[left] * (1.0 - f) + input[right] * f
        })
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn levels_are_bounded() {
        assert_eq!(rms_level(&[]), 0.0);
        assert_eq!(rms_level(&[1.0; 10]), 1.0);
    }
    #[test]
    fn resampling_keeps_duration() {
        assert_eq!(resample(&vec![0.5; 48000], 48000, 16000).len(), 16000);
    }
    #[test]
    fn wav_header_and_silence_guard() {
        let a = CapturedAudio {
            samples: vec![0.1; 16000],
            sample_rate: 16000,
            device_name: "test".into(),
        };
        let bytes = encode_wav(&a).unwrap();
        assert_eq!(&bytes[0..4], b"RIFF");
        let a = CapturedAudio {
            samples: vec![0.0; 16000],
            ..a
        };
        assert!(encode_wav(&a).is_err());
    }
}
