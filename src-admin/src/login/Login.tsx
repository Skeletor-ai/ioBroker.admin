import React, { Component, type JSX } from 'react';

import {
    Avatar,
    Box,
    Button,
    Checkbox,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControlLabel,
    Grid2,
    IconButton,
    Link,
    Paper,
    TextField,
    Typography,
} from '@mui/material';

import { Fingerprint, Visibility } from '@mui/icons-material';

import { type IobTheme, I18n, Connection } from '@iobroker/adapter-react-v5';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';

export interface OAuth2Response {
    access_token: string;
    expires_in: number;
    token_type: 'Bearer' | 'JWT';
    refresh_token: string;
    refresh_token_expires_in: number;
}

const boxShadow = '0 4px 7px 5px rgb(0 0 0 / 14%), 0 3px 1px 1px rgb(0 0 0 / 12%), 0 1px 5px 0 rgb(0 0 0 / 20%)';

const styles: Record<string, any> = {
    root: {
        padding: 10,
        margin: 'auto',
        display: 'flex',
        height: '100%',
        alignItems: 'center',
        borderRadius: 0,
        justifyContent: 'center',
    },
    paper: (theme: IobTheme) => ({
        backgroundColor: theme.palette.background.paper + (theme.palette.background.paper.length < 7 ? 'd' : 'dd'),
        p: '24px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100% - 48px)',
        width: 'calc(100% - 48px)',
        maxHeight: 500,
        maxWidth: 380,
        boxShadow,
    }),
    avatar: (theme: IobTheme): any => ({
        m: 1,
        backgroundColor: theme.palette.mode === 'dark' ? '#111' : '#eee',
        width: 100,
        height: 100,
        '& .MuiAvatar-img': {
            width: 'calc(100% - 4px)',
            height: 'calc(100% - 4px)',
            padding: 2,
        },
    }),
    submit: {
        margin: 8,
    },
    alert: {
        marginTop: 16,
        backgroundColor: '#f44336',
        padding: 8,
        color: '#fff',
        borderRadius: 4,
        fontSize: 16,
    },
    ioBrokerLink: {
        textTransform: 'inherit',
    },
    marginTop: {
        marginTop: 'auto',
    },
    progress: {
        textAlign: 'center',
    },
};

declare global {
    interface Window {
        loginBackgroundColor: string;
        loginBackgroundImage: string;
        loginLink: string;
        loginMotto: string;
        login: string;
        loginLogo: string;
        loginHideLogo: string;
        loginTitle: string;
        /** If the SSO feature is active, it is set to string 'true' */
        ssoActive: string;
    }
}

interface TwoFAData {
    challengeId: string;
    options: any;
}

interface LoginState {
    inProcess: boolean;
    username: string;
    password: string;
    stayLoggedIn: boolean;
    showPassword: boolean;
    error: string;
    loggingIn: boolean;
    webauthnAvailable: boolean;
    requires2FA: boolean;
    twoFAData: TwoFAData | null;
}

export default class Login extends Component<object, LoginState> {
    private readonly passwordRef: React.RefObject<HTMLInputElement>;

    constructor(props: object) {
        super(props);

        const loggingIn = this.authenticateWithRefreshToken();

        this.state = {
            inProcess: false,
            stayLoggedIn: false,
            showPassword: false,
            username: '',
            password: '',
            error: '',
            loggingIn,
            webauthnAvailable: browserSupportsWebAuthn(),
            requires2FA: false,
            twoFAData: null,
        };

        // apply image
        const body = window.document.body;
        body.style.backgroundColor = window.loginBackgroundColor;
        body.style.backgroundImage = window.loginBackgroundImage;
        body.style.backgroundSize = 'cover';
        this.passwordRef = React.createRef();
    }

    static async processTokenAnswer(stayLoggedIn: boolean, response: Response): Promise<boolean> {
        if (response.ok) {
            const data: OAuth2Response = await response.json();

            if (data?.access_token) {
                // Save expiration time of access token and refresh token
                // Next loaded page with socket will take the ownership of the tokens
                Connection.saveTokensStatic(data, stayLoggedIn);

                // Get href from origin
                // Extract from the URL like "http://localhost:8084/login?href=http://localhost:63342/ioBroker.socketio/example/index.html?_ijt=nqn3c1on9q44elikut4rgr23j8&_ij_reload=RELOAD_ON_SAVE" the href
                const urlObj = new URL(window.location.href);
                const href = urlObj.searchParams.get('href');
                let origin;
                if (href) {
                    origin = href;
                    if (origin.startsWith('#')) {
                        origin = `./${origin}`;
                    }
                } else {
                    origin = './';
                }
                window.location.href = origin;
                return true;
            }
        }
        Connection.deleteTokensStatic();

        return false;
    }

    private authenticateWithRefreshToken(): boolean {
        const tokens = Connection.readTokens();

        if (tokens?.refresh_token) {
            void fetch('../oauth/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `grant_type=refresh_token&refresh_token=${tokens.refresh_token}&stayloggedin=${tokens.stayLoggedIn}&client_id=ioBroker`,
            })
                .then(async response => {
                    if (!(await Login.processTokenAnswer(tokens.stayLoggedIn, response))) {
                        this.setState({
                            inProcess: false,
                            loggingIn: false,
                        });
                    } else {
                        // In processTokenAnswer the redirect will be done if already logged in
                    }
                })
                .catch(error => {
                    console.error(`Cannot fetch access token: ${error}`);
                    this.setState({
                        inProcess: false,
                        loggingIn: false,
                    });
                });
            return true;
        }

        return false;
    }

    onLogin(): void {
        this.setState({ inProcess: true, error: '' }, async () => {
            try {
                const response = await fetch('../oauth/token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: `grant_type=password&username=${encodeURIComponent(this.state.username)}&password=${encodeURIComponent(this.state.password)}&stayloggedin=${this.state.stayLoggedIn}&client_id=ioBroker`,
                });

                if (response.ok) {
                    const data = await response.json();

                    // Check if 2FA is required
                    if (data.requires2FA) {
                        this.setState({
                            inProcess: false,
                            requires2FA: true,
                            twoFAData: { challengeId: data.challengeId, options: data.options },
                        });
                        // Auto-trigger 2FA
                        setTimeout(() => this.on2FAVerify(), 300);
                        return;
                    }

                    // Normal token response
                    if (data.access_token) {
                        Connection.saveTokensStatic(data, this.state.stayLoggedIn);
                        const urlObj = new URL(window.location.href);
                        const href = urlObj.searchParams.get('href');
                        window.location.href = href?.startsWith('#') ? `./${href}` : href || './';
                        return;
                    }
                }

                this.setState({
                    inProcess: false,
                    error: I18n.t('wrongPassword'),
                });
            } catch {
                this.setState({
                    inProcess: false,
                    error: I18n.t('wrongPassword'),
                });
            }
        });
    }

    async on2FAVerify(): Promise<void> {
        const { twoFAData, stayLoggedIn } = this.state;
        if (!twoFAData) {
            return;
        }

        this.setState({ inProcess: true, error: '' });
        try {
            const assertion = await startAuthentication({ optionsJSON: twoFAData.options });

            const response = await fetch('../webauthn/2fa/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    challengeId: twoFAData.challengeId,
                    credential: assertion,
                }),
            });

            if (await Login.processTokenAnswer(stayLoggedIn, response)) {
                return;
            }
            this.setState({ inProcess: false, error: I18n.t('2FA verification failed'), requires2FA: false, twoFAData: null });
        } catch (e) {
            this.setState({
                inProcess: false,
                error: (e as Error).message || I18n.t('2FA verification failed'),
                requires2FA: false,
                twoFAData: null,
            });
        }
    }

    async onPasskeyLogin(): Promise<void> {
        this.setState({ inProcess: true, error: '' });
        try {
            // Get authentication options
            const optionsRes = await fetch('../webauthn/login/options', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: this.state.username || undefined }),
            });

            if (!optionsRes.ok) {
                const err = await optionsRes.json();
                this.setState({ inProcess: false, error: err.error || 'Failed to get passkey options' });
                return;
            }

            const optionsData = await optionsRes.json();
            const { challengeId, ...authOptions } = optionsData;

            const assertion = await startAuthentication({ optionsJSON: authOptions });

            const verifyRes = await fetch('../webauthn/login/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ challengeId, credential: assertion }),
            });

            if (await Login.processTokenAnswer(this.state.stayLoggedIn, verifyRes)) {
                return;
            }
            this.setState({ inProcess: false, error: I18n.t('Passkey login failed') });
        } catch (e) {
            this.setState({
                inProcess: false,
                error: (e as Error).message || I18n.t('Passkey login failed'),
            });
        }
    }

    render(): JSX.Element {
        const link =
            window.loginLink && window.loginLink !== '@@loginLink@@' ? window.loginLink : 'https://www.iobroker.net/';
        const motto =
            window.loginMotto && window.loginMotto !== '@@loginMotto@@' ? window.loginMotto : 'Discover awesome. ';

        if (window.login !== 'true' && window.login !== '@@auth@@') {
            // eslint-disable-next-line no-debugger
            debugger;
            window.location.href = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
        }
        const style =
            (window.loginBackgroundColor && window.loginBackgroundColor !== 'inherit') || window.loginBackgroundImage
                ? { background: '#00000000' }
                : {};

        let content: React.JSX.Element;
        if (this.state.loggingIn) {
            content = (
                <div
                    style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                    }}
                >
                    ...
                </div>
            );
        } else {
            content = (
                <Paper sx={styles.paper}>
                    <Grid2
                        container
                        direction="column"
                        alignItems="center"
                    >
                        {window.loginLogo && window.loginLogo !== '@@loginLogo@@' ? (
                            <Box
                                sx={{
                                    width: 100,
                                    height: 100,
                                    borderRadius: '5px',
                                    padding: '5px',
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                }}
                            >
                                <img
                                    src={window.loginLogo}
                                    alt="logo"
                                    style={{ maxWidth: '100%', maxHeight: '100%' }}
                                />
                            </Box>
                        ) : (
                            (window.loginHideLogo === 'false' || window.loginHideLogo === '@@loginHideLogo@@') && (
                                <Avatar
                                    sx={styles.avatar}
                                    src="img/admin.svg"
                                />
                            )
                        )}
                        <Typography
                            component="h1"
                            variant="h5"
                        >
                            {window.loginTitle && window.loginTitle !== '@@loginTitle@@'
                                ? window.loginTitle
                                : I18n.t('loginTitle')}
                        </Typography>
                        {window.location.search.includes('error') || this.state.error ? (
                            <div style={styles.alert}>{this.state.error || I18n.t('wrongPassword')}</div>
                        ) : null}
                        <TextField
                            variant="outlined"
                            margin="normal"
                            disabled={this.state.inProcess}
                            required
                            value={this.state.username}
                            onChange={e => this.setState({ username: e.target.value })}
                            onKeyUp={e => {
                                if (e.key === 'Enter' && this.state.username) {
                                    e.preventDefault();
                                    this.passwordRef.current?.focus();
                                }
                            }}
                            fullWidth
                            size="small"
                            id="username"
                            label={I18n.t('enterLogin')}
                            name="username"
                            autoComplete="username"
                            autoFocus
                        />
                        <TextField
                            variant="outlined"
                            margin="normal"
                            disabled={this.state.inProcess}
                            required
                            fullWidth
                            ref={this.passwordRef}
                            value={this.state.password}
                            onChange={e => this.setState({ password: e.target.value })}
                            onKeyUp={e => {
                                if (e.key === 'Enter' && this.state.username && this.state.password) {
                                    this.onLogin();
                                }
                            }}
                            slotProps={{
                                input: {
                                    endAdornment: this.state.password ? (
                                        <IconButton
                                            tabIndex={-1}
                                            aria-label="toggle password visibility"
                                            onClick={() => {
                                                this.setState({ showPassword: !this.state.showPassword }, () => {
                                                    setTimeout(() => this.passwordRef.current?.focus(), 50);
                                                });
                                            }}
                                        >
                                            <Visibility />
                                        </IconButton>
                                    ) : null,
                                },
                            }}
                            size="small"
                            name="password"
                            label={I18n.t('enterPassword')}
                            type={this.state.showPassword ? 'text' : 'password'}
                            id="password"
                            autoComplete="current-password"
                        />
                        <FormControlLabel
                            control={
                                <Checkbox
                                    id="stayloggedin"
                                    name="stayloggedin"
                                    value="on"
                                    checked={this.state.stayLoggedIn}
                                    onChange={e => this.setState({ stayLoggedIn: e.target.checked })}
                                    color="primary"
                                    disabled={this.state.inProcess}
                                />
                            }
                            label={I18n.t('Stay signed in')}
                        />
                        <Button
                            type="submit"
                            disabled={this.state.inProcess || !this.state.username || !this.state.password}
                            onClick={() => this.onLogin()}
                            fullWidth
                            variant="contained"
                            color="primary"
                            style={styles.submit}
                        >
                            {this.state.inProcess ? <CircularProgress size={24} /> : I18n.t('login')}
                        </Button>
                        {window.ssoActive === 'true' ? (
                            <Button
                                onClick={() => {
                                    window.location.href = `/sso?redirectUrl=${encodeURIComponent(`${window.origin}/#tab-intro`)}&method=login`;
                                }}
                                fullWidth
                                variant="contained"
                                color="secondary"
                            >
                                {I18n.t('Use Single-Sign On')}
                            </Button>
                        ) : null}
                        {this.state.webauthnAvailable ? (
                            <Button
                                onClick={() => this.onPasskeyLogin()}
                                disabled={this.state.inProcess}
                                fullWidth
                                variant="outlined"
                                color="primary"
                                style={{ ...styles.submit, display: 'flex', gap: 8 }}
                                startIcon={<Fingerprint />}
                            >
                                {I18n.t('Sign in with Passkey')}
                            </Button>
                        ) : null}
                    </Grid2>
                    <Box style={styles.marginTop}>
                        <Typography
                            variant="body2"
                            color="textSecondary"
                            align="center"
                        >
                            {window.loginLink && window.loginLink !== '@@loginLink@@' ? (
                                <Link
                                    style={styles.ioBrokerLink}
                                    color="inherit"
                                    href={link}
                                    rel="noopener noreferrer"
                                    target="_blank"
                                >
                                    {motto}
                                </Link>
                            ) : null}
                            {!window.loginLink || window.loginLink === '@@loginLink@@' ? motto : null}
                            {!window.loginLink || window.loginLink === '@@loginLink@@' ? (
                                <Link
                                    style={styles.ioBrokerLink}
                                    color="inherit"
                                    href={link}
                                    rel="noopener noreferrer"
                                    target="_blank"
                                >
                                    ioBroker
                                </Link>
                            ) : null}
                        </Typography>
                    </Box>
                </Paper>
            );
        }

        return (
            <Paper
                component="main"
                style={{ ...styles.root, ...style }}
            >
                {content}
                <Dialog open={this.state.requires2FA} onClose={() => this.setState({ requires2FA: false, twoFAData: null })}>
                    <DialogTitle>{I18n.t('Two-Factor Authentication')}</DialogTitle>
                    <DialogContent>
                        <DialogContentText>
                            {this.state.inProcess
                                ? I18n.t('Please verify your identity with your passkey...')
                                : I18n.t('Your account requires two-factor authentication.')}
                        </DialogContentText>
                        {this.state.inProcess && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                                <CircularProgress />
                            </Box>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => this.setState({ requires2FA: false, twoFAData: null })}>
                            {I18n.t('Cancel')}
                        </Button>
                        <Button
                            onClick={() => this.on2FAVerify()}
                            disabled={this.state.inProcess}
                            variant="contained"
                            startIcon={<Fingerprint />}
                        >
                            {I18n.t('Verify')}
                        </Button>
                    </DialogActions>
                </Dialog>
            </Paper>
        );
    }
}
