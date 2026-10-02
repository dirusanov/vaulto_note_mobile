export type RootStackParamList = {
    SignIn: undefined;
    SignUp: undefined;
    LegalAcceptance: { legalToken: string; provider?: 'google' | 'email' | string };
    NotesList: { startRecordingAt?: number } | undefined;
    NoteEdit: {
        noteId?: string;
        initialRecording?: any;
        initialTranscribe?: boolean;
        initialStorageScope?: 'sync' | 'local_only';
        initialPrivacy?: 'normal' | 'hidden';
        /** Text shared from another app ("Share -> Vaulto"). */
        sharedText?: string;
    };
    Settings: undefined;
    AskNotes: { question?: string } | undefined;
};
