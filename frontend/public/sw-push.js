// Service Worker push handler for AEMS notifications
self.addEventListener('push', function(event) {
    var data = {}
    try { data = event.data ? event.data.json() : {} } catch(e) {}
    var title = data.title || 'AEMS'
    var options = {
        body: data.body || '',
        data: data,
        icon: '/brand/favicon.png',
        badge: '/brand/favicon.png',
        tag: 'aems-' + ((data.data && data.data.type) || data.type || 'geral'),
    }
    event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', function(event) {
    event.notification.close()
    var url = (event.notification.data && event.notification.data.url) || '/ponto'
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            for (var i = 0; i < clientList.length; i++) {
                var client = clientList[i]
                if ('focus' in client) {
                    client.navigate(url)
                    return client.focus()
                }
            }
            if (clients.openWindow) return clients.openWindow(url)
        })
    )
})
