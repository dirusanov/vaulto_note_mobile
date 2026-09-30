export type RootStackParamList = {
    SignIn: undefined;
    SignUp: undefined;
    LegalAcceptance: { legalToken: string; provider?: 'google' | 'email' | string };
    NotesList: undefined;
    NoteEdit: {
        noteId?: string;
        initialRecording?: any;
        initialTranscribe?: boolean;
        initialStorageScope?: 'sync' | 'local_only';
        initialPrivacy?: 'normal' | 'hidden';
    };
    Settings: undefined;
    AskNotes: { question?: string } | undefined;
};
