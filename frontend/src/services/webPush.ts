import apiClient from './api/client'

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length) as Uint8Array<ArrayBuffer>
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i)
    }
    return outputArray
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
    if (!buffer) return ''
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i])
    }
    return window.btoa(binary)
}

export async function subscribeWebPush(): Promise<void> {
    // 1. GET public key
    const keyRes = await apiClient.get<{ public_key: string; enabled: boolean }>(
        '/push/web-public-key'
    )
    const { public_key, enabled } = keyRes.data

    // 2. If push not enabled server-side, bail out
    if (!enabled) return

    // 3. Wait for SW to be ready
    const registration = await navigator.serviceWorker.ready

    // 4. Subscribe
    const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key),
    })

    const subscriptionJson = subscription.toJSON()

    // 5. POST subscription to backend
    await apiClient.post('/push/web-subscriptions', {
        endpoint: subscription.endpoint,
        keys: {
            p256dh: arrayBufferToBase64(subscription.getKey('p256dh')),
            auth: arrayBufferToBase64(subscription.getKey('auth')),
        },
        user_agent: navigator.userAgent,
    })

    // Suppress unused variable warning
    void subscriptionJson
}

export async function unsubscribeWebPush(): Promise<void> {
    // 1. Wait for SW to be ready
    const registration = await navigator.serviceWorker.ready

    // 2. Get existing subscription
    const subscription = await registration.pushManager.getSubscription()

    if (!subscription) return

    // 3. DELETE from backend then unsubscribe locally
    await apiClient.delete('/push/web-subscriptions', {
        data: { endpoint: subscription.endpoint },
    })
    await subscription.unsubscribe()
}
