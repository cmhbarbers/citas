self.addEventListener('install',event=>{self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});
self.addEventListener('push',event=>{let data={title:'CMH Barbers',body:'Tienes una actualización.',url:'/'};try{data={...data,...event.data.json()};}catch{}event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'/images/logo.png',badge:'/images/logo.png',data:{url:data.url}}));});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{const url=event.notification.data?.url||'/';for(const client of list){if('focus'in client){client.navigate(url);return client.focus();}}return clients.openWindow(url);}));});
