// Backend API URL (replace with your Render URL)
const API_URL = 'https://your-render-app.onrender.com';

// Show notification
function showNotification(message, isError = false) {
    const notification = document.getElementById('notification');
    const notificationText = document.getElementById('notification-text');
    
    if (isError) {
        notification.style.background = 'linear-gradient(to right, #ff4b4b, #ff7b7b)';
    } else {
        notification.style.background = 'linear-gradient(to right, #7e4fd3, #5a6bd8)';
    }
    
    notificationText.textContent = message;
    notification.classList.add('show');
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// Load event media from backend
async function loadEvent() {
    const eventId = document.getElementById('event-id-input').value.trim();
    
    if (!eventId) {
        showNotification('Please enter an Event ID', true);
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/event/${eventId}`);
        
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Event not found. Please check the Event ID.');
            } else {
                throw new Error('Failed to load event');
            }
        }
        
        const eventData = await response.json();
        displayMedia(eventData.media);
        showNotification(`Loaded ${eventData.media.length} media items from event`);
    } catch (error) {
        console.error('Error loading event:', error);
        showNotification(error.message, true);
    }
}

// Display media in gallery
function displayMedia(mediaItems) {
    const gallery = document.getElementById('media-gallery');
    
    if (!mediaItems || mediaItems.length === 0) {
        gallery.innerHTML = '<p class="placeholder">No media found for this event</p>';
        return;
    }
    
    gallery.innerHTML = '';
    
    mediaItems.forEach(item => {
        const mediaElement = document.createElement('div');
        mediaElement.className = 'media-item';
        
        if (item.type === 'photo') {
            mediaElement.innerHTML = `
                <img src="${item.file_path}" alt="Event photo" loading="lazy">
                <div class="type-badge">Photo</div>
            `;
        } else {
            mediaElement.innerHTML = `
                <video controls>
                    <source src="${item.file_path}" type="video/mp4">
                    Your browser does not support the video tag.
                </video>
                <div class="type-badge">Video</div>
            `;
        }
        
        gallery.appendChild(mediaElement);
    });
}

// Allow pressing Enter to load event
document.getElementById('event-id-input').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        loadEvent();
    }
});

// Check if there's an event ID in the URL parameters
function checkUrlForEventId() {
    const urlParams = new URLSearchParams(window.location.search);
    const eventId = urlParams.get('event');
    
    if (eventId) {
        document.getElementById('event-id-input').value = eventId;
        loadEvent();
    }
}

// Initialize page
window.onload = function() {
    checkUrlForEventId();
};
