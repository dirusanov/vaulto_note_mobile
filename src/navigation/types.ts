export type RootStackParamList = {
    SignIn: undefined;
    SignUp: undefined;
    LegalAcceptance: { legalToken: string; provider?: 'google' | 'email' | string };
    NotesList: undefined;
    NoteEdit: { noteId?: string; initialRecording?: any; initialTranscribe?: boolean }; // using any for simplicity, or import AudioRecording
    Settings: undefined;
};
