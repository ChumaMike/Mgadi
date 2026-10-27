// Stand-in for livekit-client. Retell's v3 web calls use the "gateway" transport (plain WebRTC to
// api.retellai.com), so the LiveKit transport bundled inside the SDK is never used. Keeping it out
// removes a large unused dependency and the LiveKit hosts from our Content-Security-Policy.
// If Retell ever returned a LiveKit transport, the call fails loudly here instead of silently.
const unavailable = () => { throw new Error('The LiveKit transport is not included in the Mgadi build.'); };
export class Room { constructor() { unavailable(); } }
export class LocalAudioTrack {}
export class RemoteAudioTrack {}
export class RemoteTrack {}
export class RemoteTrackPublication {}
export const RoomEvent = {};
export const ParticipantEvent = {};
export const Track = { Kind: {}, Source: {} };
export const createAudioAnalyser = unavailable;
export const createLocalAudioTrack = unavailable;
