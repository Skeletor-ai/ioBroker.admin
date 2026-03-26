import React, { Component, type JSX } from 'react';
import {
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    List,
    ListItem,
    ListItemText,
    Switch,
    TextField,
    Typography,
    FormControlLabel,
} from '@mui/material';
import { Delete as DeleteIcon, Fingerprint, Add as AddIcon } from '@mui/icons-material';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { I18n } from '@iobroker/adapter-react-v5';

interface StoredCredentialInfo {
    credentialId: string;
    name: string;
    createdAt: number;
    transports?: string[];
}

interface WebAuthnManagementProps {
    /** The short username (without system.user. prefix) */
    userId: string;
    /** Whether the current user can manage these passkeys (is self or admin) */
    canManage: boolean;
}

interface WebAuthnManagementState {
    credentials: StoredCredentialInfo[];
    loading: boolean;
    error: string;
    addDialogOpen: boolean;
    newKeyName: string;
    adding: boolean;
    twoFAEnabled: boolean;
}

export default class WebAuthnManagement extends Component<WebAuthnManagementProps, WebAuthnManagementState> {
    constructor(props: WebAuthnManagementProps) {
        super(props);
        this.state = {
            credentials: [],
            loading: true,
            error: '',
            addDialogOpen: false,
            newKeyName: '',
            adding: false,
            twoFAEnabled: false,
        };
    }

    componentDidMount(): void {
        void this.loadCredentials();
    }

    async loadCredentials(): Promise<void> {
        this.setState({ loading: true, error: '' });
        try {
            const [credsRes, twoFARes] = await Promise.all([
                fetch('../login/webauthn/credentials', { credentials: 'same-origin' }),
                fetch('../login/webauthn/2fa', { credentials: 'same-origin' }),
            ]);
            const credentials = credsRes.ok ? await credsRes.json() : [];
            const twoFAData = twoFARes.ok ? await twoFARes.json() : { enabled: false };
            this.setState({ credentials, twoFAEnabled: twoFAData.enabled, loading: false });
        } catch {
            this.setState({ loading: false, error: 'Failed to load passkeys' });
        }
    }

    async toggleTwoFA(enabled: boolean): Promise<void> {
        try {
            const res = await fetch('../login/webauthn/2fa', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ enabled }),
            });
            if (!res.ok) {
                const err = await res.json();
                this.setState({ error: err.error || 'Failed to change 2FA setting' });
                return;
            }
            this.setState({ twoFAEnabled: enabled });
        } catch (e) {
            this.setState({ error: (e as Error).message || 'Failed to change 2FA setting' });
        }
    }

    async addPasskey(): Promise<void> {
        this.setState({ adding: true, error: '' });
        try {
            // 1. Get registration options
            const optionsRes = await fetch('../login/webauthn/register/options', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
            });
            if (!optionsRes.ok) {
                throw new Error('Failed to get registration options');
            }
            const optionsData = await optionsRes.json();
            const { challengeId, ...regOptions } = optionsData;

            // 2. Create credential via browser
            const credential = await startRegistration({ optionsJSON: regOptions });

            // 3. Verify with server
            const verifyRes = await fetch('../login/webauthn/register/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    challengeId,
                    credential,
                    name: this.state.newKeyName || undefined,
                }),
            });

            if (!verifyRes.ok) {
                const err = await verifyRes.json();
                throw new Error(err.error || 'Verification failed');
            }

            this.setState({ adding: false, addDialogOpen: false, newKeyName: '' });
            void this.loadCredentials();
        } catch (e) {
            this.setState({
                adding: false,
                error: (e as Error).message || 'Failed to add passkey',
            });
        }
    }

    async deletePasskey(credentialId: string): Promise<void> {
        try {
            const res = await fetch(`../login/webauthn/credentials/${encodeURIComponent(credentialId)}`, {
                method: 'DELETE',
                credentials: 'same-origin',
            });
            if (!res.ok) {
                throw new Error('Failed to delete');
            }
            void this.loadCredentials();
        } catch (e) {
            this.setState({ error: (e as Error).message || 'Failed to delete passkey' });
        }
    }

    render(): JSX.Element {
        if (!browserSupportsWebAuthn()) {
            return (
                <Typography color="textSecondary" sx={{ p: 2 }}>
                    {I18n.t('Your browser does not support passkeys')}
                </Typography>
            );
        }

        const { credentials, loading, error, addDialogOpen, adding, newKeyName } = this.state;
        const { canManage } = this.props;

        return (
            <Box sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom>
                    <Fingerprint sx={{ verticalAlign: 'middle', mr: 1 }} />
                    {I18n.t('Passkeys')}
                </Typography>

                {error && (
                    <Typography color="error" sx={{ mb: 1 }}>
                        {error}
                    </Typography>
                )}

                {loading ? (
                    <CircularProgress size={24} />
                ) : (
                    <>
                        {credentials.length === 0 ? (
                            <Typography color="textSecondary">
                                {I18n.t('No passkeys registered')}
                            </Typography>
                        ) : (
                            <List dense>
                                {credentials.map(cred => (
                                    <ListItem
                                        key={cred.credentialId}
                                        secondaryAction={
                                            canManage ? (
                                                <IconButton
                                                    edge="end"
                                                    onClick={() => this.deletePasskey(cred.credentialId)}
                                                    title={I18n.t('Delete')}
                                                >
                                                    <DeleteIcon />
                                                </IconButton>
                                            ) : null
                                        }
                                    >
                                        <ListItemText
                                            primary={cred.name}
                                            secondary={new Date(cred.createdAt).toLocaleDateString()}
                                        />
                                        {cred.transports?.map(t => (
                                            <Chip key={t} label={t} size="small" sx={{ ml: 0.5 }} />
                                        ))}
                                    </ListItem>
                                ))}
                            </List>
                        )}

                        {canManage && (
                            <>
                                <Button
                                    variant="outlined"
                                    startIcon={<AddIcon />}
                                    onClick={() => this.setState({ addDialogOpen: true, newKeyName: '' })}
                                    sx={{ mt: 1 }}
                                >
                                    {I18n.t('Add Passkey')}
                                </Button>

                                {credentials.length > 0 && (
                                    <Box sx={{ mt: 2 }}>
                                        <FormControlLabel
                                            control={
                                                <Switch
                                                    checked={this.state.twoFAEnabled}
                                                    onChange={e => this.toggleTwoFA(e.target.checked)}
                                                />
                                            }
                                            label={I18n.t('Use passkey as second factor (2FA)')}
                                        />
                                        <Typography variant="caption" color="textSecondary" display="block">
                                            {this.state.twoFAEnabled
                                                ? I18n.t('After password login, a passkey confirmation will be required')
                                                : I18n.t('Passkey can be used for direct login without password')}
                                        </Typography>
                                    </Box>
                                )}
                            </>
                        )}
                    </>
                )}

                <Dialog open={addDialogOpen} onClose={() => !adding && this.setState({ addDialogOpen: false })}>
                    <DialogTitle>{I18n.t('Add Passkey')}</DialogTitle>
                    <DialogContent>
                        <TextField
                            autoFocus
                            margin="dense"
                            label={I18n.t('Passkey name')}
                            fullWidth
                            value={newKeyName}
                            onChange={e => this.setState({ newKeyName: e.target.value })}
                            disabled={adding}
                            placeholder={`Passkey ${new Date().toLocaleDateString()}`}
                        />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => this.setState({ addDialogOpen: false })} disabled={adding}>
                            {I18n.t('Cancel')}
                        </Button>
                        <Button
                            onClick={() => this.addPasskey()}
                            disabled={adding}
                            variant="contained"
                            startIcon={adding ? <CircularProgress size={16} /> : <Fingerprint />}
                        >
                            {I18n.t('Register')}
                        </Button>
                    </DialogActions>
                </Dialog>
            </Box>
        );
    }
}
