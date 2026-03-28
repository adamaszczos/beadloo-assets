import cv2
import numpy as np
import sys

def extract_bead_full(image_path, output_path="bead_full.png"):
    """
    Extracts one cylindrical bead from an image, rotates it upright,
    and saves it as a 32x32 image.
    """
    img = cv2.imread(image_path)
    if img is None:
        print("Failed to read", image_path)
        return None

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5,5), 0)

    # Threshold to get beads (invert if beads are darker than background)
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Morphological closing to connect bead edges
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5,5))
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

    # Find contours (external only)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        print("No contours found")
        return None

    # Score contours to select a single bead
    best_score = -1
    best_cnt = None

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 200:  # ignore small blobs
            continue

        x, y, w, h = cv2.boundingRect(cnt)
        rect_area = w * h
        if rect_area == 0:
            continue

        rectangularity = area / rect_area
        aspect_ratio = h / w if w > 0 else 0

        # Score: prefer large, tall, rectangular beads
        score = area * rectangularity * (1 + (aspect_ratio - 1)**2)

        if score > best_score:
            best_score = score
            best_cnt = cnt

    if best_cnt is None:
        print("No bead found")
        return None

    # Fit rotated rectangle to the selected bead
    rect = cv2.minAreaRect(best_cnt)
    box = cv2.boxPoints(rect)
    box = np.int32(box)

    # Determine rotation to make long axis vertical
    angle = rect[2]
    width, height = rect[1]
    if width < height:
        angle = angle - 90
    center = rect[0]
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(img, M, (img.shape[1], img.shape[0]))

    # Rotate mask to crop bead
    mask = np.zeros(gray.shape, dtype=np.uint8)
    cv2.drawContours(mask, [best_cnt], -1, 255, -1)
    rotated_mask = cv2.warpAffine(mask, M, (img.shape[1], img.shape[0]))
    r_contours, _ = cv2.findContours(rotated_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    rcnt = max(r_contours, key=cv2.contourArea)
    x, y, w, h = cv2.boundingRect(rcnt)
    bead_crop = rotated[y:y+h, x:x+w]

    # Resize to 32x32
    bead_resized = cv2.resize(bead_crop, (32,32), interpolation=cv2.INTER_AREA)
    cv2.imwrite(output_path, bead_resized)
    print("Saved:", output_path)
    return output_path


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python extract_bead.py input_image.jpg output_image.png")
    else:
        extract_bead_full(sys.argv[1], sys.argv[2])
