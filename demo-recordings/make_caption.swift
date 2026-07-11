import AppKit

let args = CommandLine.arguments
guard args.count >= 5 else {
  fputs("usage: make_caption.swift output width height headline [subline]\n", stderr)
  exit(1)
}

let output = args[1]
let width = Int(args[2]) ?? 1080
let height = Int(args[3]) ?? 1920
let headline = args[4]
let subline = args.count > 5 ? args[5] : ""

let size = NSSize(width: width, height: height)
let image = NSImage(size: size)
image.lockFocus()

NSColor.clear.setFill()
NSRect(origin: .zero, size: size).fill()

func drawPill(rect: NSRect, color: NSColor, radius: CGFloat) {
  color.setFill()
  NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
}

let paragraph = NSMutableParagraphStyle()
paragraph.alignment = .center
paragraph.lineBreakMode = .byWordWrapping

let headlineFont = NSFont.systemFont(ofSize: width == 1080 ? 58 : 62, weight: .heavy)
let sublineFont = NSFont.monospacedSystemFont(ofSize: width == 1080 ? 30 : 36, weight: .semibold)

let topBox = NSRect(x: 54, y: CGFloat(height) - 270, width: CGFloat(width - 108), height: 178)
drawPill(rect: topBox, color: NSColor(calibratedWhite: 0.02, alpha: 0.82), radius: 34)

let headlineAttrs: [NSAttributedString.Key: Any] = [
  .font: headlineFont,
  .foregroundColor: NSColor.white,
  .paragraphStyle: paragraph
]
let sublineAttrs: [NSAttributedString.Key: Any] = [
  .font: sublineFont,
  .foregroundColor: NSColor(calibratedRed: 0.72, green: 0.95, blue: 1.0, alpha: 1),
  .paragraphStyle: paragraph
]

(headline as NSString).draw(in: NSRect(x: topBox.minX + 28, y: topBox.minY + 82, width: topBox.width - 56, height: 82), withAttributes: headlineAttrs)
(subline as NSString).draw(in: NSRect(x: topBox.minX + 28, y: topBox.minY + 28, width: topBox.width - 56, height: 46), withAttributes: sublineAttrs)

let bottomBox = NSRect(x: 54, y: 106, width: CGFloat(width - 108), height: 118)
drawPill(rect: bottomBox, color: NSColor(calibratedWhite: 0.0, alpha: 0.72), radius: 30)
let ctaAttrs: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: width == 1080 ? 34 : 40, weight: .bold),
  .foregroundColor: NSColor.white,
  .paragraphStyle: paragraph
]
("AgentPay: the control surface for agent spend + secrets" as NSString)
  .draw(in: NSRect(x: bottomBox.minX + 28, y: bottomBox.minY + 38, width: bottomBox.width - 56, height: 48), withAttributes: ctaAttrs)

image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
  fputs("failed to render png\n", stderr)
  exit(1)
}

try png.write(to: URL(fileURLWithPath: output))
