export type RootStackParamList = {
    SignIn: undefined;
    SignUp: undefined;
    NotesList: undefined;
    NoteEdit: { noteId?: string; initialRecording?: any }; // using any for simplicity, or import AudioRecording
    Settings: undefined;
};
