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
    /** section: scroll to that group on open (the AI sign-in prompt links to Voice & AI). */
    Settings: { section?: 'voice' } | undefined;
    Trash: undefined;
    AskNotes: { question?: string; recentDays?: number } | undefined;
};
