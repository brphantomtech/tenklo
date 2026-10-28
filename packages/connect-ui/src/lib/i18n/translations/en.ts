const en = {
    common: {
        dialogLabel: 'Connect an integration',
        close: 'Close',
        loading: 'Loading',
        back: 'Back',
        finish: 'Finish',
        tryAgain: 'Try Again',
        connecting: 'Connecting...',
        connect: 'Connect',
        viewGuide: 'View connection guide',
        needHelp: 'Need help?',
        securedBy: 'Secured by',
        step: 'Step {current} of {total}'
    },
    integrationsList: {
        title: 'Select Integration',
        description: 'Please select an API integration from the list below.',
        noIntegrations: 'No integration found.',
        noIntegrationsDescription: "You haven't configured any integration in this environment. Add your first integration in the Tenklo dashboard.",
        connectTo: 'Connect to {provider}',
        searchPlaceholder: 'Search integrations',
        noResults: 'No integration matches "{query}".',
        error: 'An error occurred while loading configuration'
    },
    go: {
        linkAccount: 'Link {provider} Account',
        fieldDocumentation: 'View documentation for {field}',
        showSecret: 'Show {field}',
        hideSecret: 'Hide {field}',
        connect: 'Connect',
        success: 'Success!',
        successMessage: "You've successfully set up your {provider} integration.",
        connectionFailed: 'Connection failed',
        connectionErrorGeneric: 'An error occurred during authorization. Please reach out to our support team.',
        showErrorDetails: 'Show error details',
        hideErrorDetails: 'Hide error details',
        tryAgain: 'Please try again',
        backToList: 'Back to integrations list',
        willConnect: "We'll connect you to {provider}.",
        popupWarning: "A pop-up will open, please make sure your browser doesn't block pop-ups.",
        popupBlocked: 'Auth pop-up blocked by your browser, please allow pop-ups to open.',
        popupClosed: 'The auth pop-up was closed before the end of the process, please try again.',
        closeTab: 'You can now close this tab.',
        authorizationFailed: 'Authorization failed.',
        invalidCredentials: '{provider} did not validate your credentials. Please check the values and try again.',
        resourceCapped: 'You have reached the maximum number of connections allowed. Please reach out to the admin.',
        invalidPreconfigured: 'A pre-configured field set by the administrator is invalid, please reach out to support.'
    },
    whatsapp: {
        title: 'Scan the QR code with WhatsApp',
        step1: 'Open WhatsApp on your phone.',
        step2: 'Go to Settings → Linked devices → Link a device.',
        step3: 'Point your phone at this screen to scan the code.',
        generating: 'Generating QR code...',
        linking: 'Linking your number...',
        refreshes: 'The code refreshes automatically.',
        qrTimeout: 'The QR code was not scanned in time. Please try again.',
        banned: 'WhatsApp blocked this number.',
        failed: 'The number could not be linked. Please try again.',
        unavailable: 'WhatsApp is not available right now. Please try again later.'
    }
};

export default en;
export type Translation = typeof en;
