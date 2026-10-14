import AudioMotionAnalyzer from './audiomotion-analyzer.js';

window.AudioMotionAnalyzer = AudioMotionAnalyzer;
window.dispatchEvent(new Event('audiomotion-ready'));
