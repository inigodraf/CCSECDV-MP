window.onload = function () {
    const tx = document.getElementsByTagName("textarea");
    for (let i = 0; i < tx.length; i++) {
        tx[i].setAttribute("style", "height:" + (tx[i].scrollHeight) + "px; overflow-y:hidden;");
        tx[i].addEventListener("input", function () {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + "px";
        }, false);
    }

    const stars = document.querySelectorAll('.star');
    let rating = 0;

    stars.forEach((star) => {
        star.addEventListener('mouseover', () => highlightStars(star.dataset.rating));
        star.addEventListener('mouseout', () => highlightStars(rating));
        star.addEventListener('click', () => {
            rating = star.dataset.rating;
            highlightStars(rating);
        });
    });

    function highlightStars(count) {
        stars.forEach((star, index) => {
            star.classList.toggle('active', index < count);
        });
    }

    const clearButton = document.getElementById('clearButton');
    if (clearButton) {
        clearButton.addEventListener('click', () => {
            document.getElementById('name').value = '';
            document.getElementById('email').value = '';
            document.getElementById('review').value = '';
            rating = 0;
            highlightStars(rating);
        });
    }

    const submitButton = document.getElementById('submitButton');
    if (submitButton) {
        submitButton.addEventListener('click', (event) => {
            event.preventDefault();
            const name = document.getElementById('name').value.trim();
            const email = document.getElementById('email').value.trim();
            const review = document.getElementById('review').value.trim();
            
            if (!name || !email || !review || rating === 0) {
                alert('Please fill out all fields and provide a rating before submitting.');
                return;
            }
            
            alert(`Review submitted successfully with ${rating} stars!\nName: ${name}\nEmail: ${email}\nReview: ${review}`);
            window.location.href = "index.html";
        });
    }
};
